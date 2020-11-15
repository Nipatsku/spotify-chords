


# Dev notes

## Spotify Auth flow

Authorization Code Flow:
- refreshable access to user information
- requires client secret + redirecting users to spotify grant page


Client Credentials flow:
- no access to user information.
- only requires Spotify client ID + secret


## Spotify dev dashboard

https://developer.spotify.com/dashboard/applications


## Rate limiting

Note: If Web API returns status code 429, it means that you have sent too many requests. When this happens, check the Retry-After header, where you will see a number displayed. This is the number of seconds that you need to wait, before you try your request again.
