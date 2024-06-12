import fs from 'fs'
import path from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { Client } from '@notionhq/client'
import axios from 'axios'
import dotenv from 'dotenv'
import { NotionToMarkdown } from 'notion-to-md'

dotenv.config()

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 从环境变量中获取密钥和数据库ID
const notion = new Client({ auth: process.env.NOTION_SECRET })
const databaseId = process.env.NOTION_DATABASE_ID

// 初始化 NotionToMarkdown
const n2m = new NotionToMarkdown({
  notionClient: notion,
  config: {
    separateChildPage: true,
  },
})

// 确保目录存在，如果不存在则创建它
const contentDir = path.join(__dirname, 'src/content/posts')
const imageDir = path.join(__dirname, 'src/assets/images/')
for (const dir of [contentDir, imageDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const createFrontMatter = async (properties, slug) => {
  const frontMatter = [
    '---',
    `title: ${properties.title.title[0].plain_text}`,
    `published: ${
      new Date(properties.date.date.start).toISOString().split('T')[0]
    }`,
    `description: ${properties.description.rich_text[0]?.plain_text || ''}`,
    `category: ${properties.category.select.name}`,
    `tags: [${properties.tags.multi_select.map(tag => tag.name).join(', ')}]`,
    `draft: ${!properties.published.checkbox}`,
    `slug: ${properties.slug.rich_text[0]?.plain_text}`,
  ]

  if (properties.image && properties.image.files.length > 0) {
    const imageUrl = properties.image.files[0].file.url
    const imageFileName = `${slug}-cover${path.extname(imageUrl.split('?')[0])}`
    const localImagePath = path.join(imageDir, imageFileName)
    await downloadImage(imageUrl, localImagePath)
    frontMatter.push(`image: "../../assets/images/${imageFileName}"`)
  }

  frontMatter.push('---')
  return frontMatter.join('\n')
}

const downloadImage = async (url, filePath) => {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  })

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)
    writer.on('error', reject)
    writer.on('close', resolve)
  })
}

const extractPageContent = async (pageId, fileName, properties) => {
  try {
    const mdBlocks = await n2m.pageToMarkdown(pageId)
    let mdString = n2m.toMarkdownString(mdBlocks).parent

    const imageUrls = mdString.match(/!\[.*?\]\((https:\/\/[^)]+)\)/g) || []
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i].match(/\((https:\/\/[^)]+)\)/)[1]
      const imageFileName = `${fileName}-${i + 1}${path.extname(
        url.split('?')[0],
      )}`
      const localImagePath = path.join(imageDir, imageFileName)
      await downloadImage(url, localImagePath)
      mdString = mdString.replace(url, `../../assets/images/${imageFileName}`)
    }

    const frontMatter = await createFrontMatter(properties, fileName)
    const content = `${frontMatter}\n\n${mdString}`
    const filePath = path.join(contentDir, `${fileName}.md`)
    fs.writeFileSync(filePath, content)
    // console.log(`Page content extracted successfully and saved to ${filePath}`)
  } catch (error) {
    console.error('Error extracting page content:', error)
  }
}

const getPagesFromDatabase = async () => {
  try {
    const response = await notion.databases.query({ database_id: databaseId })
    const pages = response.results

    const tasks = pages.map((page, index) => {
      const properties = page.properties
      const fileName = properties.slug.rich_text[0]?.plain_text || page.id
      console.log(
        `Processing page ${index + 1} of ${pages.length}: ${fileName}`,
      )
      return extractPageContent(page.id, fileName, properties)
    })

    await Promise.all(tasks)
  } catch (error) {
    console.error('Error retrieving pages from database:', error)
  }
}

getPagesFromDatabase()
