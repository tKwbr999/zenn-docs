import fs from 'fs/promises';
import path from 'path';
import { markdownToBlocks } from '@tryfabric/martian';
import matter from 'gray-matter';

const convertMarkdownToNotionBlocks = async (filePath) => {
  const outputFilePath = 'output.json'; // 出力ファイル名
  try {
    const markdownContent = await fs.readFile(filePath, 'utf-8');
    // Frontmatter をパース
    const { content: markdownBody, data: frontmatter } = matter(markdownContent);
    console.log('--- Frontmatter ---');
    console.log(frontmatter);
    console.log('--- Notion Blocks ---');
    const notionBlocks = markdownToBlocks(markdownBody);
    // 結果をファイルに出力
    await fs.writeFile(outputFilePath, JSON.stringify(notionBlocks, null, 2));
    console.log(`Conversion successful. Output saved to ${outputFilePath}`);
  } catch (error) {
    console.error(`Error converting markdown file ${filePath}:`, error);
  }
};

// サンプルファイルのパスを指定
const sampleFilePath = path.join('articles', '2b6b1d3bd81334.md');

convertMarkdownToNotionBlocks(sampleFilePath);