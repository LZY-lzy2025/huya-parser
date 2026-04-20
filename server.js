import worker from './worker.js';

// 监听 10000 端口
const port = process.env.PORT || 10000;
console.log(`🚀 Huya Resolver 启动成功，监听端口: ${port}`);

export default {
  port: port,
  fetch: worker.fetch,
};
