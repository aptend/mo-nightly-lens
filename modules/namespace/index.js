const DEFAULT_GRAFANA_BASE = 'https://grafana.ci.matrixorigin.cn/explore';
const DEFAULT_GRAFANA_APP = 'nightly-regression-dis-dn';
const DEFAULT_GRAFANA_REGEX = '(?i)game is on';

export class NamespaceExtractor {
  extract(logText) {
    if (!logText || typeof logText !== 'string') {
      return null;
    }

    const match = logText.match(/No resources found in ([a-zA-Z0-9-]+) namespace/);
    return match ? match[1] : null;
  }
}

function normalize(text) {
  return (text || '').trim().toLowerCase();
}

export function buildGrafanaUrl(
  namespace,
  { app = DEFAULT_GRAFANA_APP, range, regex = DEFAULT_GRAFANA_REGEX } = {}
) {
  if (!namespace) {
    return null;
  }

  const expr =
    '{namespace="' +
    namespace +
    '", app="' +
    app +
    '"} |~ `' +
    (regex || DEFAULT_GRAFANA_REGEX) +
    '`';

  let resolvedRange = { from: 'now-3h', to: 'now' };
  if (range && range.from != null && range.to != null) {
    resolvedRange = {
      from: String(range.from),
      to: String(range.to)
    };
  }

  const panes = {
    KMD: {
      datasource: 'loki',
      queries: [
        {
          refId: 'A',
          expr,
          queryType: 'range',
          datasource: { type: 'loki', uid: 'loki' },
          editorMode: 'builder'
        }
      ],
      range: resolvedRange
    }
  };

  const searchParams = new URLSearchParams({
    panes: JSON.stringify(panes),
    schemaVersion: '1',
    orgId: '1'
  });

  return `${DEFAULT_GRAFANA_BASE}?${searchParams.toString()}`;
}

export { normalize };

