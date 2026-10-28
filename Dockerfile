# ---------- 构建与运行一体镜像 ----------
FROM node:20-alpine

# better-sqlite3 预编译二进制；若无匹配则回退源码编译所需工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads

# 数据与上传目录（可挂载卷持久化）
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000

CMD ["node", "server.js"]
