const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\yooshin\\.gemini\\antigravity\\brain\\de89f8c0-a9f9-489c-9305-03f33d55182e\\.system_generated\\steps\\825\\content.md', 'utf8');

const regex = /<FeatureType>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<Title>(.*?)<\/Title>[\s\S]*?<\/FeatureType>/g;
let match;
while ((match = regex.exec(content)) !== null) {
  if (match[2].includes('용도지역') || match[2].includes('관리지역') || match[2].includes('용도지구') || match[2].includes('용도구역') || match[2].includes('계획관리')) {
    console.log(`Layer: ${match[1]}, Title: ${match[2]}`);
  }
}
