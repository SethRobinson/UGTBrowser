// src/content/ui/markdown.js
// Markdown to HTML conversion for chat and lesson display

/**
 * Convert markdown text to HTML for display in UI components
 */
export function simpleMarkdownToHtml(text) {
  if (!text) return '';
  
  // Use Unicode markers for placeholders to avoid conflicts with markdown syntax
  const PH_START = '\u2987'; // ⦇
  const PH_END = '\u2988';   // ⦈
  
  // First, extract and protect code blocks before any other processing
  const codeBlockPlaceholders = [];
  let protectedText = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `${PH_START}CODEBLOCK${codeBlockPlaceholders.length}${PH_END}`;
    codeBlockPlaceholders.push({ lang, code: code.trim() });
    return placeholder;
  });
  
  // Protect inline code
  const inlineCodePlaceholders = [];
  protectedText = protectedText.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `${PH_START}INLINECODE${inlineCodePlaceholders.length}${PH_END}`;
    inlineCodePlaceholders.push(code);
    return placeholder;
  });
  
  // Extract and protect markdown links before escaping HTML
  const linkPlaceholders = [];
  protectedText = protectedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const placeholder = `${PH_START}LINK${linkPlaceholders.length}${PH_END}`;
    linkPlaceholders.push({ text: linkText, url: url });
    return placeholder;
  });
  
  // Also protect plain URLs (http/https) that aren't already in markdown links
  const urlPlaceholders = [];
  protectedText = protectedText.replace(/(?<![\[(])(https?:\/\/[^\s<>\[\]()]+)/g, (match, url) => {
    const placeholder = `${PH_START}URL${urlPlaceholders.length}${PH_END}`;
    urlPlaceholders.push(url);
    return placeholder;
  });
  
  // Escape HTML special characters (for safety)
  let html = protectedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Apply inline formatting BEFORE restoring placeholders
  
  // Convert **bold** to <strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: inherit; background: transparent;">$1</strong>');
  
  // Convert __bold__ to <strong>
  html = html.replace(/__([^_]+)__/g, '<strong style="color: inherit; background: transparent;">$1</strong>');
  
  // Convert _italic_ to <em>
  html = html.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, '<em style="color: inherit; background: transparent;">$1</em>');
  
  // Convert *italic* to <em> (but not at start of line to avoid bullet conflicts)
  html = html.replace(/(?<!^|\n|\*)\*([^*\n]+)\*(?!\*)/g, '<em style="color: inherit; background: transparent;">$1</em>');
  
  // Convert ~~strikethrough~~ to <del>
  html = html.replace(/~~([^~]+)~~/g, '<del style="color: inherit; background: transparent;">$1</del>');
  
  // NOW restore all placeholders after formatting is complete
  
  // Restore code blocks with styling
  codeBlockPlaceholders.forEach((block, index) => {
    const placeholder = `${PH_START}CODEBLOCK${index}${PH_END}`;
    const escapedCode = block.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(placeholder, `<pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.4; margin: 8px 0;"><code>${escapedCode}</code></pre>`);
  });
  
  // Restore inline code with styling
  inlineCodePlaceholders.forEach((code, index) => {
    const placeholder = `${PH_START}INLINECODE${index}${PH_END}`;
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(placeholder, `<code style="background: rgba(0,0,0,0.08); padding: 2px 6px; border-radius: 4px; font-family: 'Consolas', 'Monaco', monospace; font-size: 0.9em;">${escapedCode}</code>`);
  });
  
  // Restore markdown links as actual HTML links
  linkPlaceholders.forEach((link, index) => {
    const placeholder = `${PH_START}LINK${index}${PH_END}`;
    const safeUrl = link.url.replace(/&amp;/g, '&');
    html = html.replace(placeholder, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #4f7cff; text-decoration: underline; cursor: pointer;">${link.text}</a>`);
  });
  
  // Restore plain URLs as clickable links
  urlPlaceholders.forEach((url, index) => {
    const placeholder = `${PH_START}URL${index}${PH_END}`;
    const safeUrl = url.replace(/&amp;/g, '&');
    const displayUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
    html = html.replace(placeholder, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #4f7cff; text-decoration: underline; cursor: pointer;">${displayUrl}</a>`);
  });
  
  // Split into lines for block-level processing
  const lines = html.split('\n');
  const processedLines = [];
  let inUnorderedList = false;
  let inOrderedList = false;
  let inBlockquote = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Check for headers (# ## ### #### ##### ######)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      if (inBlockquote) { processedLines.push('</blockquote>'); inBlockquote = false; }
      
      const level = headerMatch[1].length;
      const headerText = headerMatch[2];
      const sizes = { 1: '1.6em', 2: '1.4em', 3: '1.2em', 4: '1.1em', 5: '1em', 6: '0.95em' };
      const weights = { 1: '700', 2: '700', 3: '600', 4: '600', 5: '600', 6: '500' };
      processedLines.push(`<div style="all: revert; display: block; font-size: ${sizes[level]}; font-weight: ${weights[level]}; margin: 12px 0 8px 0; color: #1a1a2e; background: transparent; border: none; padding: 0;">${headerText}</div>`);
      continue;
    }
    
    // Check for horizontal rule (---, ***, ___)
    if (/^([-*_]){3,}$/.test(line)) {
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      if (inBlockquote) { processedLines.push('</blockquote>'); inBlockquote = false; }
      processedLines.push('<hr style="border: none; border-top: 1px solid #d1d5db; margin: 12px 0;">');
      continue;
    }
    
    // Check for blockquote (>)
    const blockquoteMatch = line.match(/^&gt;\s*(.*)$/);
    if (blockquoteMatch) {
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      if (!inBlockquote) {
        processedLines.push('<blockquote style="all: revert; border-left: 4px solid #6b8afd; margin: 8px 0; padding: 8px 16px; background: rgba(107, 138, 253, 0.05); color: #4a5568; font-style: italic;">');
        inBlockquote = true;
      }
      processedLines.push(`<p style="all: revert; margin: 4px 0; color: #4a5568; background: transparent;">${blockquoteMatch[1] || '&nbsp;'}</p>`);
      continue;
    } else if (inBlockquote) {
      processedLines.push('</blockquote>');
      inBlockquote = false;
    }
    
    // Check for ordered list (1. 2. 3. etc)
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (!inOrderedList) {
        processedLines.push('<ol style="all: revert; margin: 8px 0 8px 20px; padding-left: 0; list-style-position: outside; color: #2d3748; background: transparent;">');
        inOrderedList = true;
      }
      processedLines.push(`<li style="all: revert; margin: 4px 0; color: #2d3748; background: transparent; display: list-item;">${orderedMatch[2]}</li>`);
      continue;
    }
    
    // Check for unordered list / bullet points (*, -, •)
    const bulletMatch = line.match(/^[\*\-•]\s+(.+)$/);
    if (bulletMatch) {
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      if (!inUnorderedList) {
        processedLines.push('<ul style="all: revert; margin: 8px 0 8px 20px; padding-left: 0; list-style-type: disc; list-style-position: outside; color: #2d3748; background: transparent;">');
        inUnorderedList = true;
      }
      processedLines.push(`<li style="all: revert; margin: 4px 0; color: #2d3748; background: transparent; display: list-item;">${bulletMatch[1]}</li>`);
      continue;
    }
    
    // Close any open lists for non-list content
    if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
    if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
    
    if (line === '') {
      // Empty line - add spacing
      processedLines.push('<div style="height: 8px;"></div>');
    } else {
      // Regular paragraph - use defensive styling
      processedLines.push(`<p style="all: revert; margin: 6px 0; color: #2d3748; background: transparent;">${line}</p>`);
    }
  }
  
  // Close any remaining open tags
  if (inUnorderedList) processedLines.push('</ul>');
  if (inOrderedList) processedLines.push('</ol>');
  if (inBlockquote) processedLines.push('</blockquote>');
  
  return processedLines.join('');
}
