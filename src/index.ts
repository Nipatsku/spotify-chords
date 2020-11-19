import * as dotenv from 'dotenv'
dotenv.config()
import "reflect-metadata";
import * as express from 'express'
import * as request from 'request-promise-native'
import { Connection, createConnection, getConnection } from 'typeorm'
import { IUserActivePlayback, IUserProfile } from './interfaces';
import { User } from './entity/User';
import * as puppeteer from 'puppeteer'


let BACKEND_URL
let PORT
let MODE
let CLIENT_ID
let CLIENT_SECRET

//#region *** .env ***

const parseEnv = ( name ) => {
    const value = process.env[name]
    if ( value === undefined ) throw new Error(`Missing .env variable: ${ name}`)
    return value
}
MODE = process.env.NODE_ENV || 'development'
PORT = parseEnv( 'PORT' )
BACKEND_URL = parseEnv( 'BACKEND_URL' )
CLIENT_ID = parseEnv( 'CLIENT_ID' )
CLIENT_SECRET = parseEnv( 'CLIENT_SECRET' )

//#endregion

//#region *** Authorization code auth flow ***

/**
 * Exchange auth code for access + refresh tokens.
 */
const getAccessTokens = async ( authCode, redirectUri ) => {
    return JSON.parse(
        await request({
            method: 'POST',
            uri: 'https://accounts.spotify.com/api/token',
            headers: {
                Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
                'grant_type': 'authorization_code',
                'code': authCode,
                'redirect_uri': redirectUri
            }
        })
    )
}

/**
 * Refresh access + refresh tokens.
 */
const refreshAccessTokens = async ( refreshToken ) => {
    return JSON.parse(
        await request({
            method: 'POST',
            uri: 'https://accounts.spotify.com/api/token',
            headers: {
                Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
                'grant_type': 'refresh_token',
                'refresh_token': refreshToken
            }
        })
    )
}

//#endregion

//#region *** Spotify helper functions ***

const getUserProfile = async ( auth ) => {
    const { access_token } = auth
    return JSON.parse(
        await request({
            method: 'GET',
            uri: 'https://api.spotify.com/v1/me',
            headers: {
                Authorization: `Bearer ${ access_token }`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    ) as IUserProfile
}

const getUserActivePlayback = async ( auth ) => {
    const { access_token } = auth
    const response = await request({
        method: 'GET',
        uri: 'https://api.spotify.com/v1/me/player',
        headers: {
            Authorization: `Bearer ${ access_token }`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
    return response && response.length > 0 ?
        JSON.parse(
            response
        ) as IUserActivePlayback :
        undefined
}

/**
 * @param auth 
 * @param volume [0, 100]
 */
const setUserVolume = async ( auth, volume ) => {
    const { access_token } = auth
    volume = Math.round( Math.min(Math.max( volume, 0 ), 100) )
    try {
        const response = await request({
            method: 'PUT',
            uri: `https://api.spotify.com/v1/me/player/volume?volume_percent=${ volume }`,
            headers: {
                Authorization: `Bearer ${ access_token }`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch ( e ) {
        console.error(`ERROR setUserVolume: ${ e.message }`)
        if ( 'message' in e ) {
            console.error(e.message)
            if ( 'data' in e.message ) {
                console.error(e.message.data)
            }
        }
    }
}

//#endregion




;(async () => {
    const Database = await createConnection( MODE )
    const UserRepository = Database.getRepository( User )

    const port = PORT
    const app = express()
    
    app.listen( port, function () {
        console.log("Server is running on "+ port +" port");
    })

    app.get('/login', function(req, res) {
        console.log('\tA new victim has knocked on our door...')

        const scopes = 'user-read-private user-read-playback-state user-modify-playback-state';
        const redirectUri = 'http://localhost:3000/login-redirect'
    
        res.redirect('https://accounts.spotify.com/authorize' +
          '?response_type=code' +
          '&client_id=' + CLIENT_ID +
          (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
          '&redirect_uri=' + encodeURIComponent(redirectUri) +
          '&state=' + encodeURIComponent(JSON.stringify({ redirectUri })) +
          '&show_dialog=true'
        );
    })
    
    app.get('/login-redirect', async function(req, res) {
        console.log('\t->Redirect login')
        const url = req.url
        
        let error
        try {
            error = url.match( /error=([^\&]*)/ )[1]
            console.error(`auth error: ${ error }`)
            return
        } catch ( e ) {}
    
        let state = url.match( /state=([^\&]*)/ )[1]
        state = JSON.parse(decodeURIComponent(state))
        const { redirectUri } = state
        console.log(`\t\tstate: `, state)
    
        const code = url.match( /code=([^\&]*)/ )[1]
        console.log(`\t\tcode: `, code)


        console.log(`\tAuthenticating...`)
        const auth = await getAccessTokens( code, redirectUri )
        console.log(`\t\tauth: `, auth)


        // * Get user info from Spotify *
        console.log(`\tGetting user information...`)
        const info = await getUserProfile( auth )
        console.log( `\t\tuser info: `, info )


        // Check if User is already in database.
        let user = await UserRepository.findOne({ where: { id: info.id } })
        if ( ! user ) {
            // New user.
            console.log(`\tFirst time login as ${ info.display_name }`)
            user = new User()
            const userProperties = {} as Partial<User>
            userProperties.access_token = auth.access_token
            userProperties.refresh_token = auth.refresh_token
            userProperties.id = info.id
            userProperties.display_name = info.display_name
            userProperties.uri = info.uri
            userProperties.href = info.href

            for ( const key in userProperties ) {
                user[key] = userProperties[key]
            }
            user = await UserRepository.save( user )
            console.log(`\t\tSaved user to database`)

        } else {
            // Old user.
            const userProperties = {} as Partial<User>
            userProperties.access_token = auth.access_token
            userProperties.refresh_token = auth.refresh_token
            userProperties.dead = false
            await UserRepository.update( user.id, userProperties )
            user = await UserRepository.findOne( user.id )
            console.log(`\t\tUpdated user access tokens`)
        }

        console.log(`\t\tuser: `, user)
        res.send(`Login confirmed, proceed to ${BACKEND_URL + '/'}`)
        // res.redirect( BACKEND_URL + '/' )
    })

    app.get('/', async function(req, res) {
        const user = await UserRepository.findOne()
        if ( ! user ) {
            res.redirect( BACKEND_URL + '/login' )
        }
        const activePlayback = await getUserActivePlayback( user.getAuth() )
        const query = activePlayback.item.name + ' ' + activePlayback.item.artists[0].name + ' chords'
        console.log('query:', query)
        
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        const url = `https://www.google.com/search?q=${ encodeURI( query ) }`
        await page.goto( url );
        const results = await page.evaluate(() => {
            const resultsContainer = document.getElementById('rso')
            const results = Array.from( resultsContainer.getElementsByTagName('a') )
            return results.map( a => a.href )
        })
        await browser.close();

        console.log(`${results.length} results`)
        const result =
            results.find( url => url.includes( 'ultimate-guitar.com' ) ) ||
            results[0]
        console.log(`->${result}`)
        res.redirect( result )
    })


})()
