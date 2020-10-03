# Ace Connector

After 2 years, I finally realized that.
This library allows to control the [Ace Stream Engine](https://wiki.acestream.media/).
Only windows platform supported now!
Ace Stream needs to be installed.

## Terms

[Ace Stream](http://www.acestream.org/) — TODO.
TODO: Ace Engine or Ace Stream Engine

## What you can do

- Get info about the engine (wether it started or not)
- Start or stop the engine
- Start http stream from the torrent (file or uri)

## Example use

See [example.ts](./example.ts)

## Removing the ads

If param `removeBrowserAds` isn't false, it will check wether installed ace stream contains builtin ads or not (only on engine start).
If so, it will automatically download and install the patch.

## Auto Reconnect

Started ace stream creates an icon in the tray.
So user can stop the engine at any time.

If param `autoReconnect` isn't false and the engine
