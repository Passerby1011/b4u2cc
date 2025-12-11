// 测试 tool_result 修复效果的脚本
const testRequest = {
  "max_tokens": 64000,
  "messages": [
    {
      "content": "详细介绍一下《烽火十四》",
      "role": "user"
    },
    {
      "content": [
        {
          "text": " \n\n我来帮你搜索一下《烽火十四》的详细信息 🔍\n\n\n",
          "type": "text"
        },
        {
          "id": "toolu_ugJykWgtOTZK",
          "input": {
            "query": "烽火十四",
            "searchTimeRange": "anytime"
          },
          "name": "lobe-web-browsing____search____builtin",
          "type": "tool_use"
        }
      ],
      "role": "assistant"
    },
    {
      "content": [
        {
          "content": [
            {
              "text": "<searchResults>\n  <item title=\"烽火十四\" url=\"https://store.steampowered.com/app/4228810/_/\" />\n  <item title=\"烽火十四\" url=\"https://store.steampowered.com/app/4228810/_/?l=schinese\" />\n  <item title=\"如何评价国产抗日题材FPS 游戏《烽火十四》发布首支先导 ...\" url=\"https://www.zhihu.com/question/1980307100778325712\" />\n  <item title=\"Fourteen Years of Flames 烽火十四 | New Chinese Indie ...\" url=\"https://www.youtube.com/watch?v=aXbqFhnutuQ\" />\n  <item title=\"《烽火十四》公布预告\" url=\"https://www.ign.com.cn/topic/57528/video/feng-huo-shi-si-gong-bu-yu-gao\" />\n  <item title=\"烽火：枕戈待旦 · 烽火十四\" url=\"https://steamdb.info/app/4228810/\" />\n  <item title=\"国产抗日《烽火十四》首曝确认是实机游戏时长曝光\" url=\"https://www.gamersky.com/news/202512/2055135.shtml\" />\n  <item title=\"烽火十四游戏配置要求介绍\" url=\"https://www.3dmgame.com/gl/3974864.html\" />\n  <item title=\"国产抗日题材FPS游戏：烽火十四！ #游戏解说\" url=\"https://www.youtube.com/shorts/qYiLZWjHyoc\" />\n  <item title=\"Trailer for the Chinese WWII video game: 烽火十四 (14 ...\" url=\"https://www.reddit.com/r/Sino/comments/1pin64b/trailer_for_the_chinese_wwii_video_game_%E7%83%BD%E7%81%AB%E5%8D%81%E5%9B%9B_14/\" />\n  <item title=\"Post-Han : Song-Ming : Romance of the Three Kingdoms : On Seven-Star Altar, Zhuge Liang Sacrifices To The Winds; At Three Gorges, Zhou Yu Liberates the Fire - Chinese Text Project\" url=\"https://ctext.org/text.pl?node=651470&if=en\" />\n  <item title=\"烽火大秦 on Steam\" url=\"https://store.steampowered.com/app/1157330/_\" />\n  <item title=\"\" url=\"https://chinesenotes.com/words/21626.html\" />\n  <item title=\"封神演義 : 哪吒現蓮花化身 - Chinese Text Project\" url=\"https://ctext.org/fengshen-yanyi/14\" />\n  <item title=\"Legendary Story About Lantern Festival, Story of Chinese Lantern Festival\" url=\"https://www.yourchineseastrology.com/holidays/lantern-festival/legends.htm\" />\n</searchResults>",
              "type": "text"
            }
          ],
          "tool_use_id": "toolu_ugJykWgtOTZK",
          "type": "tool_result"
        }
      ],
      "role": "user"
    }
  ],
  "model": "claude-sonnet-4-5-20250929",
  "system": [
    {
      "text": "# Role\n你是 2025 年的 AI 全能日常助手。你既严谨可靠，又亲切有趣。你的核心目标是提供**准确**的信息和**自然**的陪伴。",
      "type": "text"
    }
  ],
  "thinking": {
    "budget_tokens": 32768,
    "type": "enabled"
  },
  "tools": [
    {
      "description": "a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results",
      "input_schema": {
        "properties": {
          "query": {
            "description": "The search query",
            "type": "string"
          },
          "searchCategories": {
            "description": "The search categories you can set:",
            "items": {
              "enum": ["general", "images", "news", "science", "videos"],
              "type": "string"
            },
            "type": "array"
          },
          "searchEngines": {
            "description": "The search engines you can use:",
            "items": {
              "enum": ["google", "bilibili", "bing", "duckduckgo", "npm", "pypi", "github", "arxiv", "google scholar", "z-library", "reddit", "imdb", "brave", "wikipedia", "pinterest", "unsplash", "vimeo", "youtube"],
              "type": "string"
            },
            "type": "array"
          },
          "searchTimeRange": {
            "description": "The time range you can set:",
            "enum": ["anytime", "day", "week", "month", "year"],
            "type": "string"
          }
        },
        "required": ["query"],
        "type": "object"
      },
      "name": "lobe-web-browsing____search____builtin"
    }
  ],
  "stream": true
};

console.log('测试请求:');
console.log(JSON.stringify(testRequest, null, 2));

console.log('\n\n发送测试请求到代理服务器...');

// 使用 fetch 发送请求
fetch('http://localhost:3456/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'test-key'
  },
  body: JSON.stringify(testRequest)
})
.then(response => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.text();
})
.then(data => {
  console.log('\n\n代理服务器响应:');
  console.log(data);
})
.catch(error => {
  console.error('错误:', error);
});