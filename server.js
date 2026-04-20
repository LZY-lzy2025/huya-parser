import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const app = express();

// 开启全局 CORS 跨域支持
app.use(cors());

// ================= 工具函数 =================

// 生成随机国内 IP
const getRandomIP = () => `116.228.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

// 动态获取请求头（每次请求都生成新的伪装 IP）
const getFetchHeaders = () => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.huya.com/',
  'Origin': 'https://www.huya.com',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'X-Forwarded-For': getRandomIP(),
  'Client-IP': getRandomIP()
});

// 获取真实房间号
async function getRealRid(rid) {
  const res = await fetch(`https://www.huya.com/${rid}`, { headers: getFetchHeaders() });
  const html = await res.text();
  
  const patterns = [
    /"profileRoom":\{"roomId":(\d+)/,
    /"roomId":(\d+)/,
    /data-room-id=["'](\d+)["']/
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  return rid;
}

// MD5 加密函数 (使用 Node.js 原生 crypto 模块)
async function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}

// 生成动态签名
async function generateDynamicAntiCode(anticode, uid, streamName) {
  const params = new URLSearchParams(anticode);
  const seqid = Date.now().toString();
  const wsTime = params.get('wsTime') || '';
  
  let fmRaw = '';
  try {
    fmRaw = atob(params.get('fm') || '');
  } catch (e) {
    fmRaw = '';
  }
  
  const fm = fmRaw
    .replace('$0', uid)
    .replace('$1', streamName)
    .replace('$2', seqid)
    .replace('$3', wsTime);
    
  const wsSecret = await md5(fm);
  
  const newParams = new URLSearchParams();
  newParams.set('wsSecret', wsSecret);
  newParams.set('wsTime', wsTime);
  newParams.set('u', uid);
  newParams.set('seqid', seqid);
  
  if (params.has('txyp')) newParams.set('txyp', params.get('txyp'));
  newParams.set('fs', params.get('fs') || 'bgct');
  if (params.has('sphdcdn')) newParams.set('sphdcdn', params.get('sphdcdn'));
  if (params.has('sphdDC')) newParams.set('sphdDC', params.get('sphdDC'));
  if (params.has('sphd')) newParams.set('sphd', params.get('sphd'));
  if (params.has('exsphd')) newParams.set('exsphd', params.get('exsphd'));
  newParams.set('ratio', '0');
  
  return newParams.toString();
}

// 获取直播流数据
async function getStream(rid) {
  const url = `https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=${rid}`;
  const res = await fetch(url, { headers: getFetchHeaders() });
  const json = await res.json();

  if (json.status !== 200 || json.data?.realLiveStatus !== "ON") {
    return false;
  }

  const streams = json.data?.stream?.baseSteamInfoList || [];
  if (streams.length === 0) return false;

  const uid = Math.floor(Math.random() * 9000000000) + 1000000000;
  const result = {};

  const cdnMap = {
    'hy': 'hycdn', 'al': 'alicdn', 'tx': 'txcdn',
    'hw': 'hwcdn', 'hs': 'hscdn',  'ws': 'wscdn',
  };

  for (const s of streams) {
    if (!s.sFlvUrl) continue;

    const cdn = (s.sCdnType || '').toLowerCase();
    const streamName = s.sStreamName || '';
    const flvSuffix = s.sFlvUrlSuffix || 'flv';
    const anticode = s.sFlvAntiCode || '';
    
    const dynamicAntiCode = await generateDynamicAntiCode(anticode, uid.toString(), streamName);
    
    // 拼接最终播放链接
    let streamUrl = `${s.sFlvUrl}/${streamName}.${flvSuffix}?${dynamicAntiCode}`;
    
    // ⚠️ 核心修复：注释掉强转 HTTPS 的逻辑，保留 http 以避免 404 错误
    // streamUrl = streamUrl.replace("http://", "https://");
    
    const cdnName = cdnMap[cdn] || cdn;
    result[cdnName] = streamUrl;
  }

  return Object.keys(result).length > 0 ? result : false;
}

// CDN 优选函数
function pickCDN(map, priority) {
  for (const p of priority) {
    if (map[p]) return map[p];
  }
  return Object.values(map)[0];
}

// ================= 路由逻辑 =================

app.get('/', async (req, res) => {
  const rawId = req.query.id || '11342412';
  const id = rawId.replace(/[^a-zA-Z0-9_]/g, '');
  const type = req.query.type || '302';

  if (!id) {
    return res.status(400).json({ error: "invalid_id" });
  }

  try {
    const rid = await getRealRid(id);
    const streamData = await getStream(rid);

    if (!streamData) {
      return res.status(404).json({ error: "not_live_or_not_found", room_id: id });
    }

    if (type === 'json') {
      return res.json(streamData);
    } else {
      // ⚠️ 核心修复：将阿里和虎牙官方 CDN 优先级提高，txcdn 往后放
      const priority = ['alicdn', 'hycdn', 'hwcdn', 'hscdn', 'txcdn', 'wscdn'];
      const targetUrl = pickCDN(streamData, priority);
      
      // 302 重定向
      return res.redirect(302, targetUrl);
    }
  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: "server_error", message: error.message });
  }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Huya Parser is running on port ${PORT}`);
});
