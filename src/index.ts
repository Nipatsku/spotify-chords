import * as dotenv from 'dotenv'
dotenv.config()
import "reflect-metadata";
import * as express from 'express'
import * as request from 'request-promise-native'
import { Connection, createConnection, getConnection } from 'typeorm'
import { IUserActivePlayback, IUserProfile } from './interfaces';
import { User } from './entity/User';



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

    const port = 3000
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

            res.send(`Hi, ${info.display_name}!\nThank you for compromising your Spotify account to the whims of a 3rd party!`)
        } else {
            // Old user.
            const userProperties = {} as Partial<User>
            userProperties.access_token = auth.access_token
            userProperties.refresh_token = auth.refresh_token
            userProperties.dead = false
            await UserRepository.update( user.id, userProperties )
            user = await UserRepository.findOne( user.id )
            console.log(`\t\tUpdated user access tokens`)

            res.send(`Hi, nice to see you again. Your login credentials have been once again saved by a suspicious 3rd party software.`)
        }

        console.log(`\t\tuser: `, user)
    })



    //#region *** Main functionality ***

    let test = false
    setTimeout(() => {
        console.log('test active')
        test = true
        setTimeout(() => {
            console.log('test over')
            test = false
        }, 6000)
    }, 6000)


    /**
     * Check if actions need to be done on ad ignoring of active users.
     */
    const checkOnActiveUsers = async () => {
        const users = await UserRepository.find()
        console.log(`\tcheckOnActiveUsers (${users.length})`)

        for ( const user of users ) {
            if ( user.dead ) {
                continue
            }

            const auth = user.getAuth()
            const wasPlaybackActive = user.active === true
            const activePlayback = await getUserActivePlayback( auth )
            const isPlaybackActive = activePlayback !== undefined

            if ( activePlayback ) {
                const wasAdvertisement = user.isAdvertisement || false
                const isAdvertisement = user.isAdvertisement = activePlayback.currently_playing_type === 'ad' || test
                const activeVolume = activePlayback.device.volume_percent

                if ( ! isAdvertisement && ! wasAdvertisement && activeVolume > 0 ) {
                    user.savedVolume = activeVolume
                }

                if ( wasAdvertisement !== isAdvertisement ) {
                    const targetVolume = isAdvertisement ? 0 : (user.savedVolume !== undefined ? user.savedVolume : 50)
                    console.log(`\t\tset user volume: `, targetVolume)
                    setUserVolume( auth, targetVolume )
                }

            }

            user.active = isPlaybackActive
            await UserRepository.save( user )
        }


        setTimeout( checkOnActiveUsers, INTERVAL_CHECK_ON_ACTIVE_USERS )
    }

    // Schedule tasks.
    const INTERVAL_CHECK_ON_ACTIVE_USERS = 1000 * 1
    await checkOnActiveUsers()

    //#endregion

})()
