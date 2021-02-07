# Ace Connector

After 2 years, I finally released that.
This library allows to control the [Ace Stream Engine](https://wiki.acestream.media/).
> Only windows platform supported now!

Ace Stream is not a future! It's a past, this lib will be used as a temporary workaround until I find a better alternative! [Read more here [RU]](https://lifeservice.me/zamena-ace-stream-kak-smotret-serialy-i-filmy/)

## What is AceStream?

In context of this library whenever I say AceStream I mean actually **Ace Stream Engine**, because Ace Stream itself is a very complex soft.
For example it includes their version of VLC in desktop version. And Ace Stream also has a android version, which is very popular by the way.

AceStream was written in Python in 2015 or 2016. And from the my point of view, AceStream is the most powerful torrent client for streaming. It works **significantly** better than [WebTorrent](https://webtorrent.io/desktop/) TODO comparsion. I don't really know how either WebTorrent or AceStream works, this lib is meant to be a bridge between AceStream API and your code.

## Key Features

- Auto patching to **remove ads**
- Auto reconnect (see below)
- Start HTTP stream from the torrent

## Example use

See [example.ts](./example.ts)

## Auto Reconnect

Started Ace Stream creates an icon in the tray.
So user can stop the engine at any time by clicking *exit*.

So AceConnector can restart the engine if was suspended.
