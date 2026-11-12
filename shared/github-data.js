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
    const response = await fetch(rawUrl(path, branch), { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub data request failed (${response.status}): ${path}`);
    return response.json();
  }

  root.aptsumGithubData = { rawUrl, json };
})(globalThis);
