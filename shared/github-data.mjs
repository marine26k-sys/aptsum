const repository = 'marine26k-sys/aptsum';

function ref(branch = 'main') {
  const match = location.hostname.match(/^deploy-preview-(\d+)--/);
  return match ? `refs/pull/${match[1]}/head` : `refs/heads/${branch}`;
}

export function githubRawUrl(path, branch = 'main') {
  const safePath = String(path).split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${repository}/${ref(branch)}/${safePath}?_=${Date.now()}`;
}

export async function githubJson(path, branch = 'main') {
  try {
    const response = await fetch(githubRawUrl(path, branch), { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub data request failed (${response.status}): ${path}`);
    return await response.json();
  } catch (githubError) {
    // Netlify keeps the last bundled copy as an outage fallback; GitHub is
    // always the primary source so routine data updates do not need deploys.
    try {
      const response = await fetch(`/${String(path).split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
      if (response.ok) return await response.json();
    } catch {}
    throw githubError;
  }
}
