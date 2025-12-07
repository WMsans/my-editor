export const FILES = {
  METADATA: ".collab_meta.json",
  PLUGIN_CONFIG: "plugin.json",
  SSH_CONFIG: "~/.ssh/config"
};

export const COMMANDS = {
  FILE_OPEN: "file.open",
  FILE_NEW: "file:new", // Normalized to match event naming convention in some parts
  FILE_SAVE: "file:save",
  WINDOW_RELOAD: "window.reload",
  EXECUTE_COMMAND: "executeCommand"
};

export const EVENTS = {
  FILE_OPEN: "file:open",
  FILE_SAVE: "file:save",
  FILE_NEW: "file:new",
  DOC_CHANGED: "doc-changed"
};

export const CHANNELS = {
  // IPC Channels
  READ_DIR: "read_directory",
  READ_FILE: "read_file_content",
  WRITE_FILE: "write_file_content",
  CREATE_DIR: "create_directory",
  INIT_GIT: "init_git_repo",
  GET_REMOTE: "get_remote_origin",
  PUSH_CHANGES: "push_changes",
  GIT_PULL: "git_pull"
};