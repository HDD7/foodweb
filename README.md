# 阿猪餐厅 · Web 版

由微信小程序版（`Food-wxapp`）改造的家庭菜谱管理 Web 应用，站点名「阿猪餐厅」，可自部署在任意 VPS 上。
功能与规范遵循项目内各设计文档（产品设计、点餐功能、订单查看、菜品分类、权限控制、好友模块等）。

## 功能特性

- 👤 **用户系统**：账号密码注册/登录（替代微信一键登录），JWT 会话，个人资料、头像、好友搜索码
- 🍳 **菜谱管理**：创建/编辑/删除菜谱，图片上传，食材清单、制作步骤，场景/食材/烹饪/口味多维分类，草稿与发布，公开/私密
- ✨ **AI 自动生成菜谱**：填个菜名 → DeepSeek 搜索网络菜谱 → 综合成食材/步骤/分类 → 自动配图并填入表单
- 🔍 **搜索浏览**：关键词搜索、分类筛选、制作时间筛选、搜索历史
- 🛒 **点餐**：早/中/晚餐次，从好友公开菜谱选菜，购物车，指定制作者，备注下单
- 📋 **订单管理**：待处理/处理中/已完成/已取消 状态流转，订单搜索，再次点餐
- 👥 **好友系统**：搜索码添加好友，请求双向确认，好友列表，好友菜谱浏览
- 👀 **预览模式**：未登录可浏览公开内容，受限功能引导登录（《权限控制规范.md》）

## 设计系统（v2 · 2026-10）

配色基于「暖色激发食欲 + 奶油底留白 + 深色文字锚点」的餐饮品牌原则，主色为**莓果玫瑰**，小面积强调，避免大面积高饱和粉。

| Token | 值 | 用途 |
|---|---|---|
| `--brand` | `#cf4a67` | 主色（CTA、选中态） |
| `--brand-deep` | `#9c2a45` | 按压/深强调（酒红） |
| `--brand-soft` | `#fbe8ed` | 浅玫瑰底 |
| `--honey` | `#f5a623` | 时间/评分等暖色点缀 |
| `--mint` | `#3fa98a` | 完成/新鲜语义 |
| `--bg` | `#fff8f6` | 奶油白页面底 |
| `--text` | `#2c1620` | 深李子可可（正文） |
| `--text-3` | `#7f5f6a` | 次级文字（对比度 ≥5.3:1） |

字体：正文 `--font-ui`（系统无衬线），标题 `--font-display`（宋体/衬线）营造餐厅菜单质感。

动效（均遵循 `prefers-reduced-motion`）：
- 页面进入 `pageIn`、滚动揭示 `.reveal` + 交错延迟 `--d`
- 卡片 hover 抬升 + 图片缓慢放大、按钮涟漪与光泽扫过、`tabbar` 胶囊高亮
- 点餐“加入购物车”飞入底栏动画、角标弹跳、统计数字滚动
- 骨架屏 shimmer 替代转圈

## 菜谱配图：搜图 + DeepSeek 审图

发布菜谱时可点「🔍 搜索配图」，后端会搜图后用 `deepseek-flash` 逐张审核（菜品是否对得上、能不能当封面），只让你选匹配度 ≥2 的图。

**图源优先级**（服务端）：

1. `PEXELS_API_KEY` → Pexels
2. `PIXABAY_API_KEY` → Pixabay
3. `UNSPLASH_ACCESS_KEY` → Unsplash
4. 免 key 兑底：360 图片 → 百度图片 → Bing（多源合并、自动去重）

> 免 key 的爬取源受目标站风控影响，稳定性一般；**生产建议配一个 Pexels key（免费 200 次/小时）**。

**接口**：

| 接口 | 说明 |
|---|---|
| `POST /api/images/search` | `{query, count=6, requirement, verify=true}` → 候选图 + 匹配度 |
| `POST /api/images/verify` | `{urls[], requirement}` → 只审图 |
| `GET /api/images/proxy?url=&sig=` | 图片代理（HMAC 签名防开放代理 + 私网 IP 拦截防 SSRF + 魔数嗅探） |

审图细节：服务端先下载图片再以 base64 送审（绕开防盗链），`temperature: 0` + `response_format: json_object` 保证稳定，返回 `{dish, match, usable, reason}`。

## AI 自动生成菜谱

「发布菜谱」页菜名右侧的 **✨ AI 自动生成**：

1. `POST /v1/tools/search` 搜「<菜名> 家常做法 食材 步骤」，取前 4 条长摘要作为语料
2. `deepseek-flash`（JSON 模式，temperature 0.3）综合成结构化菜谱：食材含具体用量、步骤含火候时间、场景/食材/标签分类
3. 复用搜图 + 审图链路取 1 张匹配度 ≥2 的成品图，下载存到 `uploads/` 后写回表单
4. 结果只填表单不直接入库，页面上会列出 4 条参考来源链接

实测：单次约 10 秒（搜索 1s + 综合 4s + 搜图审图 5s）。后端有每用户每小时 20 次的限流（`routes/recipe.js` 的 `genUsage`）。提示词与归一化逻辑在 `lib/recipeAI.js`，模型输出的分类/时间/难度会被强制收敛到项目枚举。

## 视觉验收工具（开发期）

```bash
npm run audit     # puppeteer 驱动本机 Chrome：批量截图 + JS 报错 + 溢出/截断/对比度审计
npm run vision -- shots/02-home.png   # DeepSeek 视觉评审（Files API + deepseek-flash）
```

- `tools/layout-audit.js` → 输出 `shots/*.png` 与 `shots/audit.json`（含 WCAG AA 对比度检查）
- `tools/vision-review.js` → 上传截图至 `POST /v1/files`，再用 `{type:'file', file_id}` 多模态评审
- 需登录态数据：默认用 `demo / 123456`（可用 `--user/--pass` 覆盖）

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Node.js + Express | REST API，对应小程序版 5 个云函数 |
| 数据库 | SQLite (better-sqlite3) | 对应云数据库 5 个集合，零外部依赖 |
| 认证 | JWT + bcrypt | 替代微信 openid 体系 |
| 前端 | 原生 SPA（Hash Router） | 无构建步骤，移动端优先 |
| 文件 | Multer 本地上传 | 替代云存储，`/uploads` 目录 |

## 快速开始（本地）

```bash
cd Food-web
npm install
npm start
# 打开 http://localhost:3000
```

## VPS 部署

### 方式一：Docker Compose（推荐）

```bash
# 1. 上传项目到 VPS 后进入目录
cd Food-web

# 2. 设置 JWT 密钥（务必修改）
export JWT_SECRET=$(openssl rand -hex 32)

# 3. 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f
```

数据持久化在 `./data`（SQLite）与 `./uploads`（图片）两个目录。

### 方式二：一键脚本（Debian 12 / Ubuntu，小内存 VPS 推荐）

不需要 Docker，用 systemd 直跑（1G 内存机器比 Docker 省 100–150MB）：

```bash
# 上传项目到服务器（只传代码，不传 node_modules / data / uploads / config.json）
scp -r Food-web root@你的IP:/root/food-web

ssh root@你的IP
cd /root/food-web

# 一条命令搞定：装 Node、加 swap、建用户、装依赖、起 systemd、配 Caddy HTTPS、装每日备份
DEEPSEEK_KEY=sk-你的key bash deploy.sh food.你的域名.com
_```

脚本会做这些事（可重复执行，已存在的东西会跳过）：

| 步骤 | 内容 |
|---|---|
| 环境检查 | 必须是 root、Debian/Ubuntu、确认目录结构 |
| 基础依赖 | curl / git / openssl / sqlite3，时区设 Asia/Shanghai |
| SWAP | 内存 <2G 自动建 1024MB swap（防 npm 编译 OOM） |
| Node | 未装或 <18 时用 NodeSource 装 Node 20 |
| 运行用户 | 创建无登录权限的系统用户 `azhu` |
| 代码 | 同步到 `/opt/azhu-restaurant`，**保留已有 data/uploads/config.json** |
| 配置 | 生成 `config.json`（jwtSecret 随机、权限 600、写入你给的 key） |
| 依赖 | `npm ci --omit=dev`（Debian x64 有预编译包，不编译） |
| 服务 | systemd 单元 `azhu.service`（自动重启、MemoryMax=512M） |
| HTTPS | 装 Caddy 反代 + 自动证书（无域名则跳过，用 IP:端口） |
| 备份 | `deploy/backup.sh` + crontab 每天 03:00，保留 14 天 |

常用参数：

```bash
bash deploy.sh                          # 无域名，仅 http://IP:3000
bash deploy.sh food.xxx.com             # 带域名，自动 HTTPS
bash deploy.sh food.xxx.com --firewall  # 同时开 ufw（自动保留 SSH 端口）
bash deploy.sh food.xxx.com --no-caddy  # 自己用 Nginx 反代
PORT=8080 APP_DIR=/srv/azhu bash deploy.sh food.xxx.com
```

部署后：

```bash
systemctl status azhu          # 状态
journalctl -u azhu -f          # 实时日志（启动会打印 [config] 自检）
systemctl restart azhu         # 改完 config.json 后重启
/opt/azhu-restaurant/deploy/backup.sh   # 手动备份
```

### 方式三：PM2 直接部署

```bash
cd Food-web
npm install --omit=dev

# 生产环境变量
export JWT_SECRET=$(openssl rand -hex 32)
export PORT=3000

# PM2 守护
npm install -g pm2
pm2 start server.js --name food-yun
pm2 save && pm2 startup
```

### Nginx 反向代理（可选，绑定域名/HTTPS）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

建议配合 `certbot --nginx` 开启 HTTPS。

## 配置：config.json（推荐）

服务端配置集中在项目根目录的 `config.json`，**不进仓库、不进镜像**（`.gitignore` + `.dockerignore` 已排除）。

```bash
cp config.example.json config.json
vi config.json          # 填 deepseekKey；jwtSecret 建议 openssl rand -hex 32
```

```json
{
  "deepseekKey": "sk-xxx",
  "deepseekModel": "deepseek-flash",
  "deepseekVisionModel": "deepseek-flash",
  "pexelsKey": "",                 // 可选，正版图库
  "pixabayKey": "",
  "unsplashKey": "",
  "port": 3000,
  "host": "0.0.0.0",
  "jwtSecret": "随机长字符串",
  "dataDir": "",                   // 留空用默认 ./data
  "uploadDir": "",                 // 留空用默认 ./uploads
  "aiGenerate": true,              // false 可关闭 AI 入口
  "imageSearch": true              // false 可关闭搜图入口
}
```

**读取优先级**：环境变量 > `config.json` > 本机 pi 凭证（仅本地开发兜底，VPS 上不存在）。
配置文件路径可用 `FOOD_CONFIG=/etc/food-yun/config.json` 指定，方便放 `/etc` 并收紧权限（`chmod 600`）。

启动时会打印自检：

```
[config] 文件: /app/config.json (已加载)
[config] ✅ AI 生成菜谱　DeepSeek key: 配置文件 config.json
[config] ✅ 搜图（审图 开）　图源: 360, baidu
```

未配置时对应的 UI 入口会自动置灰并在提示里说明原因；`GET /api/meta` 可查看当前能力状态（不含密钥）。

## 环境变量（可选，优先级更高）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口 |
| `JWT_SECRET` | 开发默认值 | **生产必须修改** |
| `DATA_DIR` | `./data` | SQLite 数据库目录 |
| `UPLOAD_DIR` | `./uploads` | 图片上传目录 |
| `DEEPSEEK_API_KEY` | — | 覆盖 config.json 里的 deepseekKey |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` / `UNSPLASH_ACCESS_KEY` | — | 覆盖对应图库 key |
| `FOOD_CONFIG` | `./config.json` | 配置文件路径 |

## API 概览

| 模块 | 接口 |
|---|---|
| 认证 | `POST /api/auth/register` `POST /api/auth/login` |
| 用户 | `GET/PUT /api/user/profile` `GET /api/user/search` `POST /api/user/searchCode` |
| 菜谱 | `GET/POST /api/recipes` `GET/PUT/DELETE /api/recipes/:id` `GET /api/recipes/recommend` `GET /api/recipes/my` `GET /api/recipes/friends` |
| AI 生成 | `POST /api/recipes/generate` `{name, withImage}` → 菜谱草稿 + 参考来源 |
| 订单 | `GET/POST /api/orders` `GET /api/orders/:id` `PUT /api/orders/:id/status` `POST /api/orders/:id/cancel` `GET /api/orders/statistics` |
| 好友 | `GET/POST/DELETE /api/friends` `GET/POST /api/friends/requests` `POST /api/friends/requests/:id/handle` |
| 上传 | `POST /api/upload`（multipart，字段名 `file`） |

统一返回格式（与云函数一致）：`{ success, message, data }`。

## 目录结构

```
Food-web/
├── server.js            # 服务入口
├── db.js                # SQLite 连接与表结构（含索引）
├── middleware/auth.js   # JWT 认证（登录/预览）
├── routes/              # auth / user / recipe / order / friend
├── public/              # 前端 SPA（无构建）
│   ├── index.html
│   ├── css/app.css
│   └── js/app.js, tagData.js   # tagData 与小程序版同源
├── data/                # SQLite 数据库（运行时生成）
├── uploads/             # 上传图片（运行时生成）
├── deploy.sh            # 一键部署脚本（systemd + Caddy）
├── deploy/              # azhu.service.tpl / Caddyfile.tpl / backup.sh
├── Dockerfile
└── docker-compose.yml
```

## 与小程序版的对应关系

| 小程序（微信云开发） | Web 版 |
|---|---|
| 微信一键登录 / openid | 账号密码注册登录 / JWT 用户 ID |
| 云函数 login/user/recipe/order/friend | `routes/` 下对应 REST 路由 |
| 云数据库 5 集合 | SQLite 5 张表（同名字段） |
| 云存储 + CDN | 本地 `uploads/` + Express 静态服务 |
| 数据库安全规则 | 服务端权限校验（同一套规则语义） |
| Vant Weapp 组件 | 原生 CSS 组件（主题色 #07c160 一致） |
