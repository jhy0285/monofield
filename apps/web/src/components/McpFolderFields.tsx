import { Button } from '@open-design/components';
import { MCP_MASKED_SECRET, type McpTemplateField } from '@open-design/contracts';

import { useT } from '../i18n';
import { isAbsoluteFolder, readEnvLine, writeEnvLine } from './mcp-env-text';
import styles from './McpFolderFields.module.css';

const LABEL = {
  GHIDRA_INSTALL_DIR: 'mcpClient.folder.ghidra',
  JAVA_HOME: 'mcpClient.folder.java',
} as const;
const HINT = {
  GHIDRA_INSTALL_DIR: 'mcpClient.folder.ghidraHint',
  JAVA_HOME: 'mcpClient.folder.javaHint',
} as const;

function known(key: string): key is keyof typeof LABEL {
  return key in LABEL;
}

/**
 * The optional install folders a preset can take (REA: Ghidra and Java), as
 * their own inputs on top of the same `KEY=VALUE` text the Env box shows. An
 * empty input removes its line, so an empty value never reaches the server. A
 * stored value comes back masked like every env value; it is shown as "saved"
 * and replaced by typing a new path.
 */
export function McpFolderFields({ fields, envText, onChange }: {
  fields: readonly McpTemplateField[];
  envText: string;
  onChange: (envText: string) => void;
}) {
  const t = useT();
  if (fields.length === 0) return null;
  return (
    <fieldset className={styles.group} data-testid="mcp-folder-fields">
      <legend>{t('mcpClient.folder.title')}</legend>
      <p className={styles.intro}>{t('mcpClient.folder.intro')}</p>
      {fields.map((field) => {
        const raw = readEnvLine(envText, field.key);
        const saved = raw === MCP_MASKED_SECRET;
        const value = saved ? '' : raw ?? '';
        const inputId = `mcp-folder-${field.key}`;
        const hintId = `${inputId}-hint`;
        const label = known(field.key) ? t(LABEL[field.key]) : field.label ?? field.key;
        return (
          <div className="mcp-row-field mcp-row-field-stack" key={field.key}>
            <label className="mcp-row-field-label" htmlFor={inputId}>{label}</label>
            <div className={styles.inputRow}>
              <input
                id={inputId}
                type="text"
                value={value}
                placeholder={saved ? t('mcpClient.folder.saved') : field.placeholder}
                aria-describedby={hintId}
                spellCheck={false}
                onChange={(event) => onChange(writeEnvLine(envText, field.key, event.target.value))}
              />
              {saved ? (
                <Button variant="ghost" onClick={() => onChange(writeEnvLine(envText, field.key, ''))}>
                  {t('mcpClient.folder.clear')}
                </Button>
              ) : null}
            </div>
            <small id={hintId} className={styles.hint}>
              {known(field.key) ? t(HINT[field.key]) : null}
              {' '}<code>{field.key}</code>
            </small>
            {value.trim() && !isAbsoluteFolder(value) ? (
              <small role="alert" className={styles.warning}>{t('mcpClient.folder.notAbsolute')}</small>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
