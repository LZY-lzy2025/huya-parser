import worker from './worker.js';

const port = process.env.PORT || 3000;
console.log(`🚀 Huya Resolver 启动成功，监听端口: ${port}`);

// Bun 原生支持接管 Cloudflare Worker 的 fetch 暴露方式
export default {
  port: port,
  fetch: worker.fetch,
};
