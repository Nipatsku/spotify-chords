
export interface IUserProfile {
    country: string,
    display_name: string,
    explicit_content: { filter_enabled: boolean, filter_locked: boolean },
    external_urls: unknown,
    followers: unknown,
    href: string,
    id: string,
    images: [],
    product: string,
    type: string,
    uri: string
}

export interface IUserActivePlayback {
    "timestamp": number,
    "device": {
        "id": string,
        "is_active": boolean,
        "is_restricted": boolean,
        "name": string,
        "type": string,
        "volume_percent": number
    },
    "progress_ms": string,
    "is_playing": boolean,
    "currently_playing_type": 'track' | 'ad' | 'episode' | 'unknown',
    "actions": {
        "disallows": {
        "resuming": boolean
        }
    },
    "item": {},
    "shuffle_state": boolean,
    "repeat_state": 'off' | 'on',
    "context": {
        "external_urls" : {},
        "href" : string,
        "type" : 'playlist' | unknown,
        "uri" : string
    }
}
