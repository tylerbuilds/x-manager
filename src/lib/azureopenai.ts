import { AzureOpenAI } from "openai";

function getAzureClient() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

  if (!endpoint || !deployment || !apiKey || !apiVersion) {
    throw new Error('Azure OpenAI environment variables are not set');
  }

  return {
    client: new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion }),
    deployment,
  };
}

export async function generateTweetsFromContext(context: string, systemPrompt: string, contextType: string = 'transcription'): Promise<string[]> {
  try {
    const { client, deployment } = getAzureClient();
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the ${contextType}:\n\n${context}` }
      ],
      max_tokens: 10000,
      temperature: 0.7,
      top_p: 1,
      model: deployment, // In Azure, model is part of deployment
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return [];
    }

    // Assuming the AI returns a list of tweets separated by a specific delimiter, e.g., "---"
    // Or in a JSON format. Let's assume JSON array of strings for robustness.
    try {
      // First, try to find a JSON array in the response
      const jsonMatch = content.match(/\[\s*"(.|\n)*?"\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Fallback for newline-separated tweets
      return content.split('\n').map((t: string) => t.trim()).filter((t: string) => t.length > 0 && t.length <= 280);
    } catch (e) {
      console.error('Failed to parse AI response as JSON, falling back to newline splitting.', e);
      return content.split('\n').map((t: string) => t.trim()).filter((t: string) => t.length > 0 && t.length <= 280);
    }

  } catch (error) {
    console.error("Error generating tweets from transcription:", error);
    throw error;
  }
} 
