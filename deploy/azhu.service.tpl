[Unit]
Description=Azhu Restaurant (Food-Yun Web)
Documentation=https://github.com/laity624/Food-Yun
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__APP_USER__
Group=__APP_USER__
WorkingDirectory=__APP_DIR__
Environment=NODE_ENV=production
Environment=PORT=__PORT__
Environment=TZ=Asia/Shanghai
ExecStart=__NODE_BIN__ server.js
Restart=always
RestartSec=3
# 1G 内存机器的保护线
MemoryMax=512M
# 关闭 core dump，省磁盘
LimitCORE=0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=azhu

[Install]
WantedBy=multi-user.target
