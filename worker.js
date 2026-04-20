/**
 * 虎牙直播流解析 - Cloudflare Workers 节点版
 * 功能：自动解析真实房间号，生成动态防盗链签名，优选CDN节点
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 1. 获取参数并进行简单安全过滤
    const rawId = url.searchParams.get('id') || '11342412';
    const id = rawId.replace(/[^a-zA-Z0-9_]/g, ''); // 仅允许字母数字下划线
    const type = url.searchParams.get('type') || '302';

    // 处理 CORS 预检请求 (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        }
      });
    }

    if (!id) {
      return jsonResponse({ error: "invalid_id" }, 400);
    }

    try {
      // 2. 获取真实房间号
      const rid = await getRealRid(id);
      
      // 3. 获取并解析直播流
      const streamData = await getStream(rid);

      if (!streamData) {
        return jsonResponse({ error: "not_live_or_not_found", room_id: id }, 404);
      }

      // 4. CDN 优选排序
      const priority = ['txcdn', 'alicdn', 'hwcdn', 'hscdn', 'hycdn', 'wscdn'];
      const targetUrl = pickCDN(streamData, priority);

      // 5. 返回结果
      if (type === 'json') {
        return jsonResponse(streamData);
      } else {
        // 302 重定向到真实流地址，并附带跨域头
        return new Response(null, {
          status: 302,
          headers: {
            'Location': targetUrl,
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

    } catch (error) {
      return jsonResponse({ error: "server_error", message: error.message }, 500);
    }
  }
};

/* ================= 工具函数 ================= */

// 返回 JSON 格式响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 模拟请求头
const fetchHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.huya.com/',
  'Origin': 'https://www.huya.com',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

// 获取真实房间号
async function getRealRid(rid) {
  const res = await fetch(`https://www.huya.com/${rid}`, { headers: fetchHeaders });
  const html = await res.text();
  
  const patterns = [
    /"profileRoom":\{"roomId":(\d+)/,
    /"roomId":(\d+)/,
    /data-room-id=["'](\d+)["']/
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return rid;
}

// MD5 加密函数 (利用 Cloudflare Workers 内置的 Web Crypto API)
async function md5(string) {
  const buffer = new TextEncoder().encode(string);
  const hashBuffer = await crypto.subtle.digest('MD5', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 生成动态签名
async function generateDynamicAntiCode(anticode, uid, streamName) {
  const params = new URLSearchParams(anticode);
  
  const seqid = Date.now().toString(); // 获取毫秒级时间戳
  const wsTime = params.get('wsTime') || '';
  
  // Base64 解码 fm 参数
  let fmRaw = '';
  try {
    fmRaw = atob(params.get('fm') || '');
  } catch (e) {
    fmRaw = '';
  }
  
  // 替换占位符
  const fm = fmRaw
    .replace('$0', uid)
    .replace('$1', streamName)
    .replace('$2', seqid)
    .replace('$3', wsTime);
    
  const wsSecret = await md5(fm);
  
  // 构建新的参数
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
  const res = await fetch(url, { headers: fetchHeaders });
  const json = await res.json();

  if (json.status !== 200 || json.data?.realLiveStatus !== "ON") {
    return false;
  }

  const streams = json.data?.stream?.baseSteamInfoList || [];
  if (streams.length === 0) return false;

  // 生成随机 UID (10位)
  const uid = Math.floor(Math.random() * 9000000000) + 1000000000;
  const result = {};

  const cdnMap = {
    'hy': 'hycdn', 'al': 'alicdn', 'tx': 'txcdn',
    'hw': 'hwcdn', 'hs': 'hscdn',  'ws': 'wscdn',
  };

  // 遍历所有可用节点
  for (const s of streams) {
    if (!s.sFlvUrl) continue;

    const cdn = (s.sCdnType || '').toLowerCase();
    const streamName = s.sStreamName || '';
    const flvSuffix = s.sFlvUrlSuffix || 'flv';
    const anticode = s.sFlvAntiCode || '';
    
    // 生成防盗链后缀
    const dynamicAntiCode = await generateDynamicAntiCode(anticode, uid.toString(), streamName);
    
    let streamUrl = `${s.sFlvUrl}/${streamName}.${flvSuffix}?${dynamicAntiCode}`;
    streamUrl = streamUrl.replace("http://", "https://");
    
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
  // 如果优先级的都没找到，返回对象中的第一个
  return Object.values(map)[0];
}
