import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export class FileSystemService {
  async readDirectory(path: string): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("read_directory", { path });
  }

  async readFile(path: string): Promise<number[]> {
    return invoke<number[]>("read_file_content", { path });
  }

  async readFileString(path: string): Promise<string> {
    const bytes = await this.readFile(path);
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  async writeFile(path: string, content: number[] | Uint8Array): Promise<void> {
    const contentArr = content instanceof Uint8Array ? Array.from(content) : content;
    return invoke("write_file_content", { path, content: contentArr });
  }

  async writeFileString(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    return this.writeFile(path, bytes);
  }

  async createDirectory(path: string): Promise<void> {
    return invoke("create_directory", { path });
  }

  // Git / SCM Operations
  async initGitRepo(path: string): Promise<void> {
    return invoke("init_git_repo", { path });
  }

  async getRemoteOrigin(path: string): Promise<string> {
    return invoke("get_remote_origin", { path });
  }

  async pushChanges(path: string, sshKeyPath: string): Promise<void> {
    return invoke("push_changes", { path, sshKeyPath });
  }

  async gitPull(path: string, sshKeyPath: string): Promise<void> {
    return invoke("git_pull", { path, sshKeyPath });
  }

  async saveIncomingProject(destPath: string, data: number[]): Promise<void> {
    return invoke("save_incoming_project", { destPath, data });
  }
}