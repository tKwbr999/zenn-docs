const fs = require('fs').promises; // Use promises version
const path = require('path');
const matter = require('gray-matter');
const { Client } = require('@notionhq/client');
const { markdownToBlocks } = require('@tryfabric/martian'); // Import martian
const dotenv = require('dotenv'); // Import dotenv

// Load environment variables from .env file (optional, for local testing)
dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_DATABASE_ID; // Use Database ID
const repoRoot = process.cwd();

if (!process.env.NOTION_API_KEY || !databaseId) { // Check for Database ID
  console.error('Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set.');
  process.exit(1);
}

// Create Notion page properties from frontmatter (for Database)
const createPageProperties = (frontmatter, relativeFilePath) => {
  const properties = {
    Name: { // Title property in Notion (must match your database)
      title: [
        {
          text: {
            content: frontmatter.title || path.basename(relativeFilePath, path.extname(relativeFilePath)), // Use filename if title missing
          },
        },
      ],
    },
    Slug: { // Slug property (assuming Rich Text type)
      rich_text: [
        {
          text: {
            // Use notion_slug if available, otherwise fallback to filename
            content: frontmatter.notion_slug || path.basename(relativeFilePath, path.extname(relativeFilePath)),
          },
        },
      ],
    },
    Tags: { // Tags property (assuming Multi-select type)
      multi_select: (frontmatter.topics || frontmatter.tags || []).map(topic => ({ name: topic })),
    },
    Published: { // Published property (assuming Checkbox type)
      checkbox: frontmatter.published === true, // Ensure boolean
    },
    // Add more properties as needed based on your database schema...
  };
  return properties;
};

// Clear all blocks from a Notion page
const clearPageBlocks = async (pageId) => {
  let hasMore = true;
  let startCursor = undefined;
  const blocksToDelete = [];

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
    });
    blocksToDelete.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`[${pageId}] Found ${blocksToDelete.length} blocks to delete.`);

  // Delete blocks in reverse order, handling potential errors
  for (const block of blocksToDelete.reverse()) {
    await new Promise(resolve => setTimeout(resolve, 300)); // Delay to avoid rate limits
    try {
      console.log(`[${pageId}] Attempting to delete block: ${block.id} (Type: ${block.type})`);
      await notion.blocks.delete({ block_id: block.id });
      console.log(`[${pageId}] Successfully deleted block: ${block.id}`);
    } catch (error) {
      if (error.code === 'validation_error' && error.message.includes('archived')) {
        console.log(`[${pageId}] Skipping archived block: ${block.id}`);
      } else if (error.code === 'conflict_error') {
         console.warn(`[${pageId}] Conflict error deleting block ${block.id}. Might be already deleted or modified. Skipping.`);
      } else {
        console.warn(`[${pageId}] Could not delete block ${block.id} (Type: ${block.type}):`, error.message);
      }
    }
  }
};

// Append blocks to a Notion page (handling 100 block limit)
const appendBlocksToPage = async (pageId, blocks) => {
  const chunkSize = 100;
  for (let i = 0; i < blocks.length; i += chunkSize) {
    const chunk = blocks.slice(i, i + chunkSize);
    try {
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
      await new Promise(resolve => setTimeout(resolve, 300)); // Add delay
    } catch (error) {
      console.error(`[${pageId}] Error appending blocks chunk ${Math.floor(i / chunkSize) + 1}:`, error);
      console.error('Failed blocks chunk:', JSON.stringify(chunk.map(b => b.type), null, 2));
      if (error.body) {
        console.error('Notion API Error Body:', error.body);
      }
      throw error; // Re-throw error to stop processing if appending fails
    }
  }
};

// Find existing page in the database by Slug
const findPageBySlug = async (slug) => {
  if (!slug) {
    console.error("Error: Slug (from notion_slug) is required to find a page.");
    return null;
  }
  try {
    console.log(`Searching for page with Slug: ${slug} in database: ${databaseId}`);
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Slug', // Assuming the property name in Notion is 'Slug'
        rich_text: {
          equals: slug,
        },
      },
    });
    if (response.results.length > 0) {
      console.log(`Found existing page with ID: ${response.results[0].id}`);
      return response.results[0];
    } else {
      console.log(`No existing page found with Slug: ${slug}`);
      return null;
    }
  } catch (error) {
    console.error(`Error finding page with Slug "${slug}":`, error);
     if (error.code === 'validation_error' && error.message.includes('database_id')) {
        console.error(`Database with ID ${databaseId} not found or not shared.`);
    } else if (error.code === 'validation_error' && error.message.includes('property')) {
        console.error(`Property 'Slug' not found in database ${databaseId}. Please check the property name.`);
    }
    return null;
  }
};

// Add or update notionPageId in the Markdown file's frontmatter
const updateFrontmatterWithPageId = async (relativeFilePath, pageId) => {
  const fullPath = path.join(repoRoot, relativeFilePath);
  try {
    let fileContent = await fs.readFile(fullPath, 'utf-8');
    const { content: markdownBody, data: frontmatter } = matter(fileContent);

    // Check if notionPageId already exists and is the same
    if (frontmatter.notionPageId === pageId) {
      return; // No update needed
    }

    // Update or add notionPageId
    const newData = { ...frontmatter, notionPageId: pageId };
    const updatedContent = matter.stringify(markdownBody, newData);

    await fs.writeFile(fullPath, updatedContent, 'utf-8');
    console.log(`[${relativeFilePath}] Updated frontmatter with notionPageId: ${pageId}`);

  } catch (error) {
    console.error(`[${relativeFilePath}] Error updating frontmatter:`, error);
  }
};


// Sync a single Markdown file to Notion (Create or Update in Database)
const syncFileToNotion = async (relativeFilePath) => {
  const fullPath = path.join(repoRoot, relativeFilePath);
  console.log(`\nProcessing file: ${relativeFilePath}`);
  try {
    const markdownContent = await fs.readFile(fullPath, 'utf-8');
    const { content: markdownBody, data: frontmatter } = matter(markdownContent);

    // Skip if 'notion: true' is not set
    if (frontmatter.notion !== true) {
      console.log(`[${relativeFilePath}] Skipping: 'notion: true' is not set in frontmatter.`);
      return;
    }

    // Skip if title is missing
    if (!frontmatter.title) {
      console.warn(`[${relativeFilePath}] Skipping: Title is missing in frontmatter.`);
      return;
    }

    // Use notion_slug if available, otherwise fallback to filename (without extension)
    const slug = frontmatter.notion_slug || path.basename(relativeFilePath, path.extname(relativeFilePath));
    if (!slug) {
        console.warn(`[${relativeFilePath}] Skipping: Could not determine slug (missing notion_slug and filename).`);
        return;
    }

    const notionBlocks = markdownToBlocks(markdownBody);
    const pageProperties = createPageProperties(frontmatter, relativeFilePath);
    // Use emoji for icon if available
    const pageIcon = frontmatter.emoji ? { type: 'emoji', emoji: frontmatter.emoji } : undefined;

    // Find existing page by slug
    const existingPage = await findPageBySlug(slug);
    let pageId = existingPage ? existingPage.id : null;

    if (pageId) {
      // --- Update Existing Page ---
      console.log(`[${relativeFilePath}] Found existing page ID: ${pageId}. Attempting to update.`);
      try {
        // 1. Update page properties and icon
        await notion.pages.update({
          page_id: pageId,
          properties: pageProperties,
          icon: pageIcon,
          archived: false, // Ensure page is not archived
        });
        console.log(`[${pageId}] Page properties and icon updated.`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay

        // 2. Clear existing blocks
        console.log(`[${pageId}] Clearing existing blocks...`);
        await clearPageBlocks(pageId);
        console.log(`[${pageId}] Existing blocks cleared.`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay

        // 3. Append new blocks
        console.log(`[${pageId}] Appending new blocks...`);
        await appendBlocksToPage(pageId, notionBlocks);
        console.log(`[${pageId}] New blocks appended.`);

        console.log(`[${relativeFilePath}] Successfully updated page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

        // Update frontmatter with the confirmed page ID (in case it was missing)
        await updateFrontmatterWithPageId(relativeFilePath, pageId);


      } catch (error) {
        console.error(`[${relativeFilePath}] Error updating page ${pageId}:`, error.message);
        if (error.body) console.error('Notion API Error Body:', error.body);
        // Optionally handle specific errors, e.g., if page was deleted manually
      }
    } else {
      // --- Create New Page ---
      console.log(`[${relativeFilePath}] No existing page found with Slug '${slug}'. Creating new page...`);
      try {
        const response = await notion.pages.create({
          parent: { database_id: databaseId }, // Create in the specified database
          properties: pageProperties,
          icon: pageIcon,
          children: notionBlocks.slice(0, 100), // Add first chunk of blocks during creation
        });
        pageId = response.id;
        console.log(`[${relativeFilePath}] New page created with ID: ${pageId}`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay

        // Append remaining blocks if any
        if (notionBlocks.length > 100) {
            console.log(`[${pageId}] Appending remaining blocks to the new page...`);
            await appendBlocksToPage(pageId, notionBlocks.slice(100));
            console.log(`[${pageId}] Remaining blocks appended to the new page.`);
        }

        // Add notionPageId to the Markdown file
        await updateFrontmatterWithPageId(relativeFilePath, pageId);

        console.log(`[${relativeFilePath}] Successfully created page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

      } catch (error) {
        console.error(`[${relativeFilePath}] Error creating page:`, error.message);
        if (error.body) console.error('Notion API Error Body:', error.body);
      }
    }

  } catch (error) {
    console.error(`[${relativeFilePath}] Error processing file:`, error);
  }
};

// --- Main Execution ---
async function main() {
  // Get file paths from command line arguments
  const filePaths = process.argv.slice(2);

  if (filePaths.length === 0) {
    console.log('No changed markdown files provided as arguments. Exiting.');
    return;
  }

  console.log(`Starting Notion sync for ${filePaths.length} file(s)...`);

  // Process each file provided as an argument
  for (const filePath of filePaths) {
    // Ensure the path is relative to the repo root if needed,
    // but GitHub Actions usually provides paths relative to the workspace root.
    await syncFileToNotion(filePath);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait between processing files
  }

  console.log('\nNotion sync finished.');
}

main().catch(error => {
  console.error('\nSync process failed:', error);
  process.exit(1);
});