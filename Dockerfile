# 构建阶段：安装依赖并打包前端
FROM mirror.ccs.tencentyun.com/library/node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# 运行阶段：nginx 托管静态文件（纯前端，无后端）
FROM mirror.ccs.tencentyun.com/library/nginx:alpine

# 复制到子路径目录（必须与 nginx.conf.template 里的 /jeju 对应）
COPY --from=builder /app/dist /usr/share/nginx/html/jeju

# nginx:alpine 启动时会把 templates/*.template 通过 envsubst 渲染为 conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
