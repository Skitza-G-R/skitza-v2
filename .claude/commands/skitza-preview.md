---
description: Print the Vercel preview URL for the current git branch
---

1. Get current branch: `git branch --show-current`
2. Query GitHub for open PRs on this branch: `gh pr list --head <branch> --json number --limit 1`
3. If a PR exists, extract the Vercel preview URL from its comments:

   ```bash
   gh pr view <PR_NUMBER> --json comments | python3 -c "
   import json, sys, re
   data = json.load(sys.stdin)
   for c in data.get('comments', []):
       m = re.search(r'([a-z0-9-]+\.vercel\.app)', c.get('body', ''))
       if m:
           print('https://' + m.group(1))
           break
   "
   ```

4. Print the URL. If no PR exists or no Vercel URL is in comments, say so and suggest pushing the branch first.
