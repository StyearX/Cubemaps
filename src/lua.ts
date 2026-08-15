export type LuaGeneratorInput = {
  tags: string;
  skyboxName: string;
  folder: string;
  remoteFolder: string;
  urlBase: string;
  urlPrefix: string;
  filePrefix: string;
};

type FaceDefinition = {
  prop: string;
  direction: string;
};

const FACE_DEFINITIONS: FaceDefinition[] = [
  { prop: 'SkyboxBk', direction: 'Back' },
  { prop: 'SkyboxFt', direction: 'Front' },
  { prop: 'SkyboxLf', direction: 'Left' },
  { prop: 'SkyboxRt', direction: 'Right' },
  { prop: 'SkyboxUp', direction: 'Top' },
  { prop: 'SkyboxDn', direction: 'Down' },
];

function escapeLuaString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function cleanPath(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function buildLuaSkybox(input: LuaGeneratorInput) {
  const tags = input.tags.trim();
  const skyboxName = input.skyboxName.trim();
  const folder = cleanPath(input.folder);
  const remoteFolder = cleanPath(input.remoteFolder);
  const urlBase = input.urlBase.trim().replace(/\/+$/, '');
  const urlPrefix = input.urlPrefix.trim();
  const filePrefix = input.filePrefix.trim();

  const faces = FACE_DEFINITIONS.map(({ prop, direction }) => {
    const remoteFile = `${urlPrefix}-${direction}.png`;
    const localFile = `${filePrefix}${direction}.png`;
    const url = [urlBase, remoteFolder, remoteFile].filter(Boolean).join('/');
    return `        { Prop = "${prop}", Url = "${escapeLuaString(url)}", File = "${escapeLuaString(localFile)}" },`;
  });

  return `    ["[ ${escapeLuaString(tags)} ] ${escapeLuaString(skyboxName)}"] = {
        Folder = "${escapeLuaString(folder)}",
        ResetHaze = true,
        Faces = {
${faces.join('\n')}
        },
    },`;
}