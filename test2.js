const https = require('https');
https.get('https://www.law.go.kr/DRF/lawSearch.do?OC=lscape8905&target=prec&type=JSON&query=' + encodeURIComponent('도시공원'), (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data.substring(0, 500)));
});
