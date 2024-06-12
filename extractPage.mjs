import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从环境变量中获取密钥和数据库ID
const notion = new Client({ auth: process.env.NOTION_SECRET });
const databaseId = process.env.NOTION_DATABASE_ID;

// 初始化 NotionToMarkdown
const n2m = new NotionToMarkdown({ 
  notionClient: notion,
  config: {
    separateChildPage: true,
  }
});

// 确保目录存在，如果不存在则创建它
const contentDir = path.join(__dirname, 'src/content/posts');
if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}

const imageDir = path.join(__dirname, 'public/images');
if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
}

async function createFrontMatter(properties, slug) {
  // 构建 YAML 头信息
  let frontMatter = [
    '---',
    `title: ${properties.title.title[0].plain_text}`,
    `published: ${new Date(properties.date.date.start).toISOString().split('T')[0]}`,
    'description: ' + (properties.description.rich_text[0]?.plain_text || ''),
    'category: ' + properties.category.select.name,
    'tags: [' + properties.tags.multi_select.map(tag => tag.name).join(', ') + ']',
    'draft: ' + !properties.published.checkbox,
    'slug: ' + properties.slug.rich_text[0]?.plain_text,
  ];

  // 检查 image 字段并下载图片
  if (properties.image && properties.image.files.length > 0) {
    console.log(properties.image.files[0].file.url)
    const imageUrl = properties.image.files[0].file.url;
    const imageFileName = `${slug}-0${path.extname(imageUrl.split('?')[0])}`;
    const localImagePath = path.join(imageDir, imageFileName);
    await downloadImage(imageUrl, localImagePath);
    frontMatter.push(`image: /images/${imageFileName}`);
  }

  frontMatter.push('---');

  return frontMatter.join('\n');
}

async function downloadImage(url, filePath) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    let error = null;
    writer.on('error', err => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on('close', () => {
      if (!error) {
        resolve();
      }
    });
  });
}

async function extractPageContent(pageId, fileName, properties) {
  try {
    // 获取页面内容并转换为 Markdown
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    let mdString = n2m.toMarkdownString(mdBlocks).parent;

    // 下载图片并替换 URL
    const imageUrls = mdString.match(/!\[.*?\]\((https:\/\/[^)]+)\)/g);
    if (imageUrls) {
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const url = imageUrl.match(/\((https:\/\/[^)]+)\)/)[1];
        const imageFileName = `blog-${fileName}-${i + 1}${path.extname(url.split('?')[0])}`;
        const localImagePath = path.join(imageDir, imageFileName);
        await downloadImage(url, localImagePath);
        mdString = mdString.replace(url, `/images/${imageFileName}`);
      }
    }

    // 创建 YAML 头信息
    const frontMatter = await createFrontMatter(properties, fileName); // 等待 createFrontMatter 完成

    // 将 YAML 头信息和 Markdown 内容组合
    const content = `${frontMatter}\n\n${mdString}`;

    // 将 Markdown 写入文件
    const filePath = path.join(contentDir, `${fileName}.md`);
    fs.writeFileSync(filePath, content);

    console.log(`Page content extracted successfully and saved to ${filePath}`);
  } catch (error) {
    console.error('Error extracting page content:', error);
  }
}

async function getPagesFromDatabase() {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
    });

    const pages = response.results;
    console.log('Pages retrieved from database:', pages);

    // 遍历所有页面并提取内容
    for (const page of pages) {
      const pageId = page.id;
      const properties = page.properties;
      console.log('Page properties:', properties);

      // 使用 slug 属性的标题作为文件名
      const fileName = properties.slug.rich_text[0]?.plain_text || page.id;
      await extractPageContent(pageId, fileName, properties);
    }
  } catch (error) {
    console.error('Error retrieving pages from database:', error);
  }
}

getPagesFromDatabase();