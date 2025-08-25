# xyOps Health Check Daemon

> A lightweight health check daemon for xyOps deployments, designed for integration with Nginx and Docker.

The document covers the internal details of the xyOps multi-master health check system.

This daemon runs alongside your Nginx container, continuously monitoring a cluster of xyOps master servers. It determines which server is currently elected as the primary master, updates the Nginx configuration accordingly, and triggers a zero-downtime graceful reload.

If the master server goes down, the daemon automatically detects the change, waits for the cluster to elect a new master, and reconfigures Nginx to point to the new leader.

# Features

- Monitors a list of xyOps master servers for health and leadership.
- Automatically rewrites Nginx upstream config to point to the active master.
- Triggers `nginx -s reload` to apply changes without downtime.
- Runs as a simple background daemon inside your Nginx container.
- MIT Licensed, minimal dependencies.

# Installation

Add this to your Docker container that is also running Nginx:

```sh
npm install -g @pixlcore/xyops-healthcheck
```

# Usage

The daemon runs when invoked thusly:

```sh
/usr/bin/xyops-healthcheck
```

It forks into the background, reads its configuration, and begins monitoring.  You'll typically run this in the same container as your Nginx instance, typically via a shell script in the `RUN` directive:

```sh
#!/bin/sh

# Start healthcheck as a background daemon process (it does this itself)
/usr/bin/xyops-healthcheck

# Start nginx in the foreground
/usr/sbin/nginx -g 'daemon off;'
```

# Configuration

Configuration is stored in `config.json` (defaults shown):

```json
{
	"log_dir": "/var/log",
	"log_filename": "healthcheck.log",
	"log_columns": ["hires_epoch", "date", "hostname", "pid", "component", "category", "code", "msg", "data"],
	"log_crashes": true,
	"temp_dir": "/tmp",
	"pid_file": "/var/run/healthcheck.pid",
	"debug_level": 5,
	
	"masters": [],
	"port": 5522,
	
	"poll_freq_sec": 5,
	"poll_proto": "http:",
	
	"nginx_conf_file": "/etc/nginx/conf.d/backend.conf",
	"nginx_template": "upstream backend {\n\tserver [host]:[port];\n}\n",
	"nginx_reload_cmd": "/usr/sbin/nginx -s reload"
}
```

## Key settings

- `masters`: Array of xyOps conductor servers to monitor.
- `port`: Health check port (default 5522).
- `poll_freq_sec`: How often (in seconds) to poll servers.
- `poll_proto`: Protocol for health checks (http: or https:).
- `nginx_conf_file`: Path to the upstream config file Nginx uses.
- `nginx_template`: Template for generating the upstream block.
- `nginx_reload_cmd`: Command to gracefully reload Nginx.

# How It Works

1.	The daemon pings all configured masters at URI `/health`.
2.	When a server reports itself as the elected master, the daemon:
	- Rewrites the `nginx_conf_file` with that server as the upstream target.
	- Executes the `nginx_reload_cmd` to apply changes.
3.	If the current master fails, the daemon retries until a new leader is found.
4.	Logs are written to `/var/log/healthcheck.log` for debugging and auditing.

# Environment Variables

For convenience, all `XYOPS_` prefixed environment variables are automatically mapped to `HEALTHCHECK_`, so you can share your xyOps environment varaibles with the Nginx container running healthcheck.  Example:

```
export XYOPS_masters="master1,master2"
export XYOPS_port=5522
```

# License

**The MIT License (MIT)**

*Copyright (c) 2025 PixlCore LLC.*

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
