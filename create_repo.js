const https = require('https');

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Please set GITHUB_TOKEN environment variable");
  process.exit(1);
}
const repoName = 'mcp-filesystem-pro';

const data = JSON.stringify({
  name: repoName,
  description: 'Zero-dependency MCP Filesystem server',
  private: false
});

const options = {
  hostname: 'api.github.com',
  path: '/user/repos',
  method: 'POST',
  headers: {
    'Authorization': `token ${token}`,
    'User-Agent': 'Node.js',
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${body}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
