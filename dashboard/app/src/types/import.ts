export type ImportTaskStatus = "pending" | "processing" | "done" | "failed";

export type ImportTaskListStatus = "empty" | "processing" | "partial" | "done";

export interface ImportTask {
  id: string;
  tenant_id: string;
  agent_id: string;
  file_name: string;
  file_type: "session" | "memory";
  status: ImportTaskStatus;
  total_count: number;
  success_count: number;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface ImportTaskList {
  tasks: ImportTask[];
  status: ImportTaskListStatus;
}
