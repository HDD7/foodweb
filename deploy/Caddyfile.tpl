__DOMAIN__ {
	encode gzip zstd

	# 上传图片可能较大
	request_body {
		max_size 12MB
	}

	reverse_proxy 127.0.0.1:__PORT__ {
		header_up X-Real-IP {remote_host}
	}

	# 静态资源与上传文件长缓存
	@static path /uploads/* /css/* /js/*
	header @static Cache-Control "public, max-age=604800"

	log {
		output file /var/log/caddy/azhu.log {
			roll_size 10mb
			roll_keep 3
		}
	}
}
