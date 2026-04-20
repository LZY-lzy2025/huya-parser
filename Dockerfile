# 使用基于 Alpine 的 Node.js 20 轻量级镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 仅拷贝依赖清单，利用 Docker 缓存加速构建
COPY package*.json ./

# 安装生产环境依赖
RUN npm install --production

# 拷贝核心代码
COPY server.js .

# 暴露 3000 端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
