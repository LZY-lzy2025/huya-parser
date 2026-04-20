FROM oven/bun:1-alpine

WORKDIR /app

# 复制文件
COPY worker.js server.js ./

# 暴露端口
EXPOSE 3000

# 运行服务
CMD ["bun", "run", "server.js"]
