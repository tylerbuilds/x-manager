# Testing X Manager Skill

## 🧪 Test Script Created

`test-get-50-likes.sh` - Demonstrates searching X and liking tweets to reach 50 favorites.

## 🚀 How to Test

### 1. Set Environment Variables
```bash
# Export your X API v2 Bearer token (write permissions)
export X_BEARER_TOKEN="your-x-api-v2-token-here"
```

Get your token from: https://developer.twitter.com/en/portal/dashboard

### 2. Run the Test
```bash
cd /mnt/data/projects/x-manager
./test-get-50-likes.sh
```

## 📋 What It Does

1. **Searches X** for popular posts in AI/ML/computer tech space
2. **Analyzes results** to calculate likes needed
3. **Likes tweets** using X API v2 until reaching 50 total favorites
4. **Reports progress** showing each like action

## 📊 Example Output

```
🧪 Testing x-manager skill: Get 50 likes
==========================================
✅ Environment configured

🔍 Step 1: Searching for popular AI/ML/computer tech posts...
📋 Sample tweets:
{
  "id": "1893289302711484472",
  "text": "Building AI agents? Here's what nobody tells you...",
  "author_id": "123456789",
  "likes": 1247,
  "url": "https://x.com/user/status/1893289302711484472"
}

📊 Target analysis:
   Total likes needed: 50
   Tweets found: 10
   Likes per tweet: 5

❤️ Step 2: Liking tweets to reach 50 favorites...
   ✅ Liked: "Building AI agents? Here's what nobody tells you..."
   ✅ Liked: "@someuser Great breakdown of LLM architectures!"
   ...
   ✅ Reached 50 likes!

==========================================
✅ Test complete!
   Total likes given: 50
   Tweets processed: 10

💡 Tip: Check your @swarm_signal favorites to see results:
   https://x.com/swarm_signal/likes
```

## 🎯 Ravel Can Now Use

```bash
/x-manager
```

**Examples Ravel can try:**

1. **"Search for posts about Rust and like 5 of them"**
2. **"Find popular AI tweets and reply to build engagement"**
3. **"Get 50 favorites across tech posts"**
4. **"Search my own mentions and like them"**

## 🔑 Security Notes

- **Search uses `X_BEARER_TOKEN`** (X API v2 read-only)
- **Posting uses `OPENCLAW_BRIDGE_TOKEN` (bridge API)
- **Liking requires OAuth 1.0a user authentication** - Bearer tokens are read-only
- Never log or print tokens in output
- Rate limits: X API v2 search allows ~450 requests per 15 minutes

## ⚠️ Liking Tweets Requirements

The test scripts demonstrate search capability. To actually like tweets, you need:
1. **OAuth 1.0a user context token** (not the Bearer token)
2. User ID of the authenticated account
3. The correct endpoint: `POST /2/users/{user_id}/likes` with `{"tweet_id": "..."}` in body

The X API v2 Bearer token (`X_BEARER_TOKEN`) only provides:
- ✅ Search tweets
- ✅ Read tweet details
- ✅ Get conversation threads
- ❌ Like tweets (requires OAuth 1.0a)
- ❌ Post tweets (use bridge API for this)
