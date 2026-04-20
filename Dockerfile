FROM oven/bun:1-alpine

WORKDIR /app

# 复制文件
COPY worker.js server.js ./

# 暴露 10000 端口
EXPOSE 10000

# 运行服务
CMD ["bun", "run", "server.js"]
