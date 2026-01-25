// src/background/prompt-builders.js
// Prompt construction utilities for various LLM interactions

/**
 * Build a prompt for follow-up chat questions about translations
 */
export function buildChatPrompt(question, originalText, culturalNuances, chatHistory, translatedText = '') {
  let prompt = `You are a helpful assistant that answers questions about translations and cultural context.

Here is the context:

**Original Text (source language, before translation):**
${originalText || '(Not available)'}

`;

  if (translatedText) {
    prompt += `**Translated Text:**
${translatedText}

`;
  }

  prompt += `**Cultural Nuances Explanation:**
${culturalNuances}

`;

  if (chatHistory && chatHistory.length > 0) {
    prompt += `**Previous Conversation:**\n`;
    for (const msg of chatHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n`;
    }
    prompt += '\n';
  }

  prompt += `**Current Question:**
${question}

Please provide a helpful, concise answer. If the question relates to the translation or cultural aspects, use the context provided. Format your response clearly, using markdown for emphasis where appropriate.`;

  return prompt;
}

/**
 * Build a prompt for lesson follow-up chat questions
 */
export function buildLessonChatPrompt(question, originalText, lessonContent, chatHistory) {
  let prompt = `You are a helpful language learning assistant. The user is studying the following text and has received a lesson about it.

**Original Text Being Studied:**
${originalText || '(Not available)'}

**Lesson Content:**
${lessonContent}

`;

  if (chatHistory && chatHistory.length > 0) {
    prompt += `**Previous Conversation:**\n`;
    for (const msg of chatHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n`;
    }
    prompt += '\n';
  }

  prompt += `**Current Question:**
${question}

Please provide a helpful, educational answer. If the question relates to the language learning content, use the lesson context provided. Feel free to add additional examples, explanations, or practice exercises as appropriate. Format your response clearly, using markdown for emphasis where appropriate.`;

  return prompt;
}

/**
 * Build a prompt for ask about selection questions
 */
export function buildAskPrompt(question, selectedText, chatHistory) {
  let prompt = `You are a helpful assistant. The user has selected some text and wants to ask a question about it.

**Selected Text:**
${selectedText}

`;

  if (chatHistory && chatHistory.length > 0) {
    prompt += `**Previous Conversation:**\n`;
    for (const msg of chatHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n`;
    }
    prompt += '\n';
  }

  prompt += `**Question:**
${question}

Please provide a helpful, clear answer. Format your response using markdown for emphasis and structure where appropriate.`;

  return prompt;
}
