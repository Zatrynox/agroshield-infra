// Build entrypoint for the patched Caddy binary used by the web image.
// It mirrors upstream's cmd/caddy/main.go so the standard HTTP, file-server,
// reverse-proxy and Caddyfile modules are registered.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
