// Public datasets are read from the repository so data-only commits do not
// require a Netlify deploy. Deploy previews read the PR head, production reads
// the requested branch.
(function (root) {
  const repository = 'marine26k-sys/aptsum';

  function ref(branch = 'main') {
    const match = location.hostname.match(/^deploy-preview-(\d+)--/);
    return match ? `refs/pull/${match[1]}/head` : `refs/heads/${branch}`;
  }

  function rawUrl(path, branch = 'main') {
    const safePath = String(path).split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${repository}/${ref(branch)}/${safePath}?_=${Date.now()}`;
  }

  async function json(path, branch = 'main') {
    try {
      const response = await fetch(rawUrl(path, branch), { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub data request failed (${response.status}): ${path}`);
      return await response.json();
    } catch (githubError) {
      try {
        const historyUrl = new URL(`https://api.github.com/repos/${repository}/commits`);
        historyUrl.searchParams.set('path', path);
        historyUrl.searchParams.set('per_page', '10');
        historyUrl.searchParams.set('sha', branch);
        const historyResponse = await fetch(historyUrl, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
        if (!historyResponse.ok) throw new Error(`GitHub history request failed (${historyResponse.status}): ${path}`);
        const commits = await historyResponse.json();
        const safePath = String(path).split('/').map(encodeURIComponent).join('/');
        for (const commit of commits) {
          if (!commit?.sha) continue;
          try {
            const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit.sha}/${safePath}?_=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) continue;
            return await response.json();
          } catch {}
        }
      } catch {}
      throw githubError;
    }
  }

  root.aptsumGithubData = { rawUrl, json };
})(globalThis);
