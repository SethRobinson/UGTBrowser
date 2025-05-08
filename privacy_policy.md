# Privacy Policy for UGTBrowser Chrome Extension

**Last Updated:** May 8th, 2025

## 1. Introduction

This Privacy Policy describes how UGTBrowser ("the Extension"), developed by Robinson Technologies Corporation ("we," "us," or "our"), handles your information. UGTBrowser allows users to translate highlighted text using various third-party Large Language Model (LLM) providers, including OpenAI, Anthropic, and Google Gemini.

This extension is open source and the source code can be reviewed on GitHub at https://github.com/SethRobinson/UGTBrowser

Our company, Robinson Technologies Corporation, is located in Japan.

## 2. Information We Do Not Collect or Store

Robinson Technologies Corporation **does not** collect, store, or transmit any of your personal information, browsing history, or the content of the text you translate through the UGTBrowser extension on our own servers.

## 3. Information You Provide and How It's Used

To use the translation features of UGTBrowser, you are required to provide your own API keys for the respective LLM services you wish to use (OpenAI, Anthropic, Google Gemini).

*   **API Keys:**
    *   Your API keys are stored locally on your computer using Chrome's storage API (`chrome.storage.local`). They are not synced with the cloud or across your devices.
    *   These keys are used solely by the extension to authenticate your requests directly with the chosen LLM provider.
    *   **Your API keys are never transmitted to Robinson Technologies Corporation or any other third party by the UGTBrowser extension itself.**
*   **Highlighted Text for Translation:**
    *   When you select text and choose to translate it, that selected text is sent directly from your browser to the API of the LLM provider you have configured (e.g., OpenAI, Anthropic, Google Gemini).
    *   This text is sent solely for the purpose of obtaining a translation.
    *   The UGTBrowser extension does not store this highlighted text after the translation request is completed.

## 4. Third-Party LLM Services

UGTBrowser acts as an interface to send your selected text and API key to third-party LLM providers for translation. These services are:

*   OpenAI (services like GPT models)
*   Anthropic (services like Claude models)
*   Google (services like Gemini models)

These third-party services have their own privacy policies and terms of service that govern how they collect, use, and store the data (including the text you send for translation and potentially your API key usage). We strongly recommend that you review the privacy policies of these providers:

*   **OpenAI:** [Link to OpenAI's Privacy Policy - e.g., https://openai.com/policies/privacy-policy]
*   **Anthropic:** [Link to Anthropic's Privacy Policy - e.g., https://www.anthropic.com/privacy]
*   **Google:** [Link to Google's Privacy Policy - e.g., https://policies.google.com/privacy]

Robinson Technologies Corporation is not responsible for the data practices of these third-party LLM providers.

## 5. Data Security

We take reasonable precautions by relying on Chrome's built-in storage mechanisms for API keys. However, as the extension is open source, you are encouraged to review the code to understand how data is handled. The security of your API keys also depends on the overall security of your computer and your Google Chrome profile.

## 6. Open Source

UGTBrowser is an open-source project. We believe in transparency and encourage users to inspect the source code on GitHub to verify the extension's behavior and how it handles data.

## 7. Children's Privacy

UGTBrowser is not intended for use by children under the age of 13 (or the relevant age of consent in your jurisdiction). We do not knowingly collect any personal information from children.

## 8. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy within the extension or on its web store listing. You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted.

## 9. Contact Us

If you have any questions about this Privacy Policy, please contact:

Seth A. Robinson
Robinson Technologies Corporation
seth@rtsoft.com

