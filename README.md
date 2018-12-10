# fatpipe

This utility is streaming piping file downloads from a source server at the highest speed possible. One common use-case could be recovering from a ZFS backup, but you don't have enough disk space to hold the backup, and the data.

```
fatpipe --url 'http://...' | gunzip - | zfs receive -F pool
```

FatPipe should only be used with streams, and does not support resumable downloads. If you need something that can do resumable downloads you can look into something like aria2.

So to sum it up, fatpipe is a pipable download accelerator.

```
Options:
  --help         Show help                                 [boolean]
  --version      Show version number                       [boolean]
  --config       conforms to fetch protocol          [default: "{}"]
  --url          url of the request                       [required]
  --silent       hide progress output               [default: false]
  --concurrency  max concurrency                       [default: 10]
  --chunk        size of the request chunks       [default: 5000000]
  --agent        user agent                  [default: Chrome 73...]
```

# installation

```
npm install -g fatpipe
```

# usage

```
fatpipe \
    --url 'http://releases.ubuntu.com/18.04.1.0/ubuntu-18.04.1.0-live-server-amd64.iso' \
    --concurrency 40 \
    --chunk 5000000 \
    --config '{"headers": {"token": "foo-bar"}}' \
    > ubuntu-18.04.1.0-live-server-amd64.iso
```

# display

You will notice the following numbers on the download progress 

- connections = amount of open connections
- chunk spread = distance between the chunk with the next index, and highest index chunk we are actively downloading
- stdout backpressure = how many writes have not completed yet 
- request status = blocking means that we are not opening new connections yet

For the best performance you should try to minimize your backpressue, if you notice that its always greater than 1 then you probably want to reduce the concurrency, or chunk size.