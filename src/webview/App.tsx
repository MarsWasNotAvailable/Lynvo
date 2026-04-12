// src/webview/App.tsx
import * as React from "react";
import { useEffect, useState, useRef } from "react";
import { LynvoBoard, LynvoTask, LynvoColumn, LynvoLabel } from "../types";

declare const acquireVsCodeApi: () => { postMessage: (msg: any) => void };
const vscode = acquireVsCodeApi();

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const PRIORITY_ORDER: Record<"low" | "medium" | "high", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PRIORITY_META: Record<
  "low" | "medium" | "high",
  { label: string; color: string }
> = {
  high: { label: "High", color: "#f85149" },
  medium: { label: "Medium", color: "#d29922" },
  low: { label: "Low", color: "#2ea043" },
};

export const App: React.FC = () => {
  const [boardData, setBoardData] = useState<LynvoBoard | null>(null);
  const [activeView, setActiveView] = useState<"board" | "insights" | "labels">(
    "board",
  );

  // Filtros y Sincronización
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState(false);

  // --- ESTADOS DE TAREAS ---
  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] = useState<
    "low" | "medium" | "high"
  >("medium");

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [editTaskPriority, setEditTaskPriority] = useState<
    "low" | "medium" | "high"
  >("medium");

  // --- ESTADOS DE COLUMNAS ---
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#007acc");

  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColTitle, setEditColTitle] = useState("");
  const [editColColor, setEditColColor] = useState("");

  // --- ESTADOS DE ETIQUETAS ---
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#f85149");

  const draggedTaskRef = useRef<string | null>(null);
  const dragOverTaskRef = useRef<string | null>(null);

  const isFiltering = searchTerm.trim().length > 0 || activeFilterLabel !== "";

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === "loadData") {
        setBoardData(event.data.data);
        setIsSyncing(false);
      } else if (event.data.command === "setView") {
        setActiveView(event.data.view);
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "requestData" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const triggerSync = () => {
    setIsSyncing(true);
    vscode.postMessage({ command: "syncBoard" });
  };

  // --- LÓGICA DRAG & DROP ---
  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (editingTaskId === id || isFiltering) {
      e.preventDefault();
      return;
    }
    draggedTaskRef.current = id;
    e.dataTransfer.setData("taskId", id);
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (isFiltering) return;

    const taskId = draggedTaskRef.current;
    const targetId = dragOverTaskRef.current;
    if (!taskId || !boardData) return;

    const updatedTasks = { ...boardData.tasks };
    updatedTasks[taskId].status = newStatus;

    let colTasks = Object.values(updatedTasks)
      .filter((t) => t.status === newStatus)
      .sort(
        (a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
      );

    colTasks = colTasks.filter((t) => t.id !== taskId);

    const targetIdx = colTasks.findIndex((t) => t.id === targetId);
    if (targetIdx === -1) colTasks.push(updatedTasks[taskId]);
    else colTasks.splice(targetIdx, 0, updatedTasks[taskId]);

    const updates = colTasks.map((t, i) => ({
      id: t.id,
      status: newStatus,
      position: i,
      isDraggedTask: t.id === taskId,
    }));

    setBoardData({ ...boardData, tasks: updatedTasks });
    vscode.postMessage({ command: "reorderTasks", updates });
    draggedTaskRef.current = null;
    dragOverTaskRef.current = null;
  };

  // --- CRUD TAREAS ---
  const openAddTaskForm = (colId: string) => {
    setAddingTaskColId(colId);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskLabels([]);
    setNewTaskPriority("medium");
  };

  const submitNewTask = () => {
    if (!newTaskTitle.trim() || !addingTaskColId) return;
    vscode.postMessage({
      command: "createTask",
      title: newTaskTitle,
      description: newTaskDesc,
      targetColId: addingTaskColId,
      labelIds: newTaskLabels,
      priority: newTaskPriority,
    });
    setAddingTaskColId(null);
  };

  const startEditingTask = (task: LynvoTask) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditLabelIds(task.labelIds || []);
    setEditTaskPriority(task.priority || "medium");
  };

  const saveEditTask = () => {
    if (!editTitle.trim() || !editingTaskId) return;
    vscode.postMessage({
      command: "editTask",
      taskId: editingTaskId,
      title: editTitle,
      description: editDesc,
      labelIds: editLabelIds,
      priority: editTaskPriority,
    });
    setEditingTaskId(null);
  };

  const toggleLabelSelection = (
    labelId: string,
    current: string[],
    setter: (val: string[]) => void,
  ) => {
    if (current.includes(labelId))
      setter(current.filter((id) => id !== labelId));
    else setter([...current, labelId]);
  };

  // --- CRUD COLUMNAS ---
  const submitNewColumn = () => {
    if (!newColTitle.trim()) return;
    vscode.postMessage({
      command: "createColumn",
      title: newColTitle,
      color: newColColor,
    });
    setIsAddingColumn(false);
    setNewColTitle("");
  };

  const startEditingColumn = (col: LynvoColumn) => {
    setEditingColId(col.id);
    setEditColTitle(col.title);
    setEditColColor(col.color);
  };

  const saveEditColumn = () => {
    if (!editColTitle.trim() || !editingColId) return;
    vscode.postMessage({
      command: "editColumn",
      colId: editingColId,
      title: editColTitle,
      color: editColColor,
    });
    setEditingColId(null);
  };

  const moveColumn = (colId: string, direction: "left" | "right") => {
    if (!boardData) return;
    const cols = Object.values(boardData.columns).sort(
      (a, b) => a.position - b.position,
    );
    const idx = cols.findIndex((c) => c.id === colId);

    const nextCols = cols.map((col) => ({ ...col }));

    if (direction === "left" && idx > 0) {
      const temp = nextCols[idx].position;
      nextCols[idx].position = nextCols[idx - 1].position;
      nextCols[idx - 1].position = temp;
    } else if (direction === "right" && idx < nextCols.length - 1) {
      const temp = nextCols[idx].position;
      nextCols[idx].position = nextCols[idx + 1].position;
      nextCols[idx + 1].position = temp;
    } else return;

    const updates = nextCols.map((c) => ({ id: c.id, position: c.position }));
    setBoardData({
      ...boardData,
      columns: Object.fromEntries(nextCols.map((c) => [c.id, c])),
    });
    vscode.postMessage({ command: "reorderColumns", updates });
  };

  // --- RENDERS ---
  const getTasksByStatusFiltered = (status: string): LynvoTask[] => {
    if (!boardData || !boardData.tasks) return [];
    return (Object.values(boardData.tasks) as LynvoTask[])
      .filter((t) => t.status === status)
      .filter(
        (t) =>
          !searchTerm ||
          t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          t.description.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      .filter(
        (t) =>
          !activeFilterLabel ||
          (t.labelIds && t.labelIds.includes(activeFilterLabel)),
      )
      .sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority || "medium"] -
            PRIORITY_ORDER[b.priority || "medium"] ||
          (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
      );
  };

  const clearFilters = () => {
    setSearchTerm("");
    setActiveFilterLabel("");
  };

  const renderLabelSelector = (
    selected: string[],
    setter: (val: string[]) => void,
  ) => {
    if (!boardData || !boardData.labels) return null;
    return (
      <div
        style={{
          display: "flex",
          gap: "5px",
          flexWrap: "wrap",
          marginBottom: "8px",
        }}
      >
        {Object.values(boardData.labels).map((label) => {
          const isSelected = selected.includes(label.id);
          return (
            <span
              key={label.id}
              onClick={() => toggleLabelSelection(label.id, selected, setter)}
              style={{
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "10px",
                cursor: "pointer",
                backgroundColor: isSelected ? label.color : "transparent",
                color: isSelected ? "#fff" : label.color,
                border: `1px solid ${label.color}`,
              }}
            >
              {label.name}
            </span>
          );
        })}
      </div>
    );
  };

  const renderTaskCard = (task: LynvoTask) => {
    const isEditing = editingTaskId === task.id;
    const isEdited = task.updatedAt - task.createdAt > 60000;

    return (
      <div
        key={task.id}
        draggable={!isEditing && !isFiltering}
        onDragStart={(e) => handleDragStart(e, task.id)}
        onDragEnter={() => {
          dragOverTaskRef.current = task.id;
        }}
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-widget-border)",
          padding: "12px",
          marginBottom: "10px",
          borderRadius: "6px",
          position: "relative",
          opacity: isFiltering ? 0.9 : 1,
        }}
      >
        {isEditing ? (
          <div>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{
                width: "100%",
                marginBottom: "8px",
                padding: "5px",
                boxSizing: "border-box",
              }}
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                marginBottom: "8px",
                padding: "5px",
                boxSizing: "border-box",
              }}
            />
            {renderLabelSelector(editLabelIds, setEditLabelIds)}
            <select
              value={editTaskPriority}
              onChange={(e) =>
                setEditTaskPriority(
                  e.target.value as "low" | "medium" | "high",
                )
              }
              style={{ width: "100%", marginBottom: "8px", padding: "5px" }}
            >
              <option value="high">Priority: High</option>
              <option value="medium">Priority: Medium</option>
              <option value="low">Priority: Low</option>
            </select>
            <div
              style={{
                display: "flex",
                gap: "5px",
                justifyContent: "flex-end",
              }}
            >
              <button onClick={() => setEditingTaskId(null)}>Cancel</button>
              <button
                onClick={saveEditTask}
                style={{
                  backgroundColor: "var(--vscode-button-background)",
                  color: "white",
                  border: "none",
                  padding: "4px 8px",
                }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <h4
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "14px",
                  paddingRight: "40px",
                  color: "var(--vscode-editor-foreground)",
                }}
              >
                {task.title}
              </h4>
              <div
                style={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  display: "flex",
                  gap: "2px",
                }}
              >
                <button
                  className="icon-btn"
                  onClick={() => startEditingTask(task)}
                >
                  ✏️
                </button>
                <button
                  className="icon-btn delete"
                  onClick={() =>
                    vscode.postMessage({
                      command: "deleteTask",
                      taskId: task.id,
                    })
                  }
                >
                  🗑️
                </button>
              </div>
            </div>

            {task.labelIds && task.labelIds.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  flexWrap: "wrap",
                  marginBottom: "8px",
                }}
              >
                {task.labelIds.map((id) => {
                  const l = boardData?.labels?.[id];
                  if (!l) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        backgroundColor: l.color,
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: "8px",
                        fontSize: "10px",
                      }}
                    >
                      {l.name}
                    </span>
                  );
                })}
              </div>
            )}

            {task.codeReference && (
              <div
                onClick={() =>
                  vscode.postMessage({
                    command: "openCode",
                    filePath: task.codeReference!.filePath,
                    lineStart: task.codeReference!.lineStart,
                  })
                }
                style={{
                  fontSize: "10px",
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  padding: "3px 6px",
                  borderRadius: "3px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  display: "inline-block",
                  color: "var(--vscode-button-secondaryForeground)",
                }}
              >
                🔗 {task.codeReference.filePath.split("/").pop()} (L:{" "}
                {task.codeReference.lineStart})
              </div>
            )}
            <p
              style={{
                fontSize: "12px",
                opacity: 0.8,
                margin: "0 0 10px 0",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              {task.description}
            </p>
            <span
              style={{
                display: "inline-block",
                marginBottom: "8px",
                fontSize: "10px",
                borderRadius: "10px",
                padding: "2px 8px",
                border: `1px solid ${PRIORITY_META[task.priority || "medium"].color}`,
                color: PRIORITY_META[task.priority || "medium"].color,
              }}
            >
              ⚑ {PRIORITY_META[task.priority || "medium"].label}
            </span>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "10px",
                opacity: 0.6,
                color: "var(--vscode-textLink-foreground)",
              }}
            >
              <span>👤 {task.lastModifiedBy?.username}</span>
              <div
                style={{
                  textAlign: "right",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                <div>🕒 {formatDateTime(task.createdAt)}</div>
                {isEdited && <div>✎ {formatDateTime(task.updatedAt)}</div>}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderLabelsManager = () => {
    return (
      <div
        style={{
          padding: "20px",
          backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
          borderRadius: "8px",
        }}
      >
        <h2>Manage Labels</h2>
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
            alignItems: "center",
          }}
        >
          <input
            type="color"
            value={newLabelColor}
            onChange={(e) => setNewLabelColor(e.target.value)}
          />
          <input
            placeholder="New label name..."
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            style={{ padding: "6px" }}
          />
          <button
            onClick={() => {
              if (newLabelName.trim()) {
                vscode.postMessage({
                  command: "createLabel",
                  name: newLabelName,
                  color: newLabelColor,
                });
                setNewLabelName("");
              }
            }}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--vscode-button-background)",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Create Label
          </button>
        </div>
        <div>
          {boardData?.labels &&
            Object.values(boardData.labels).map((label) => (
              <div
                key={label.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                }}
              >
                <span
                  style={{
                    backgroundColor: label.color,
                    color: "#fff",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                >
                  {label.name}
                </span>
                <button
                  className="icon-btn delete"
                  onClick={() =>
                    vscode.postMessage({
                      command: "deleteLabel",
                      labelId: label.id,
                    })
                  }
                >
                  🗑️ Delete
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  };

  const renderInsights = () => {
    if (!boardData) return null;
    const tasks = Object.values(boardData.tasks);
    const sortedColumns = Object.values(boardData.columns).sort(
      (a, b) => a.position - b.position,
    );
    const doneColumnIds = new Set(
      sortedColumns
        .filter((c) => /(done|hecho|complet|cerrad)/i.test(c.title))
        .map((c) => c.id),
    );
    const fallbackDoneColumn = sortedColumns[sortedColumns.length - 1]?.id;
    if (doneColumnIds.size === 0 && fallbackDoneColumn) {
      doneColumnIds.add(fallbackDoneColumn);
    }
    const done = tasks.filter((t) => doneColumnIds.has(t.status)).length;
    const percent =
      tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
    const staleTasks = tasks.filter(
      (task) => Date.now() - task.updatedAt > 1000 * 60 * 60 * 24 * 7,
    ).length;
    const highPriorityOpen = tasks.filter(
      (task) => (task.priority || "medium") === "high" && !doneColumnIds.has(task.status),
    ).length;

    const statusStats = tasks.reduce(
      (acc, task) => {
        const colTitle = boardData.columns[task.status]?.title || "Unknown";
        acc[colTitle] = (acc[colTitle] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return (
      <div
        style={{
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            flex: "1 1 100%",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Project Progress</h2>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span>
              {done} of {tasks.length} tasks completed
            </span>
            <span style={{ fontWeight: "bold" }}>{percent}%</span>
          </div>
          <div
            style={{
              width: "100%",
              height: "12px",
              backgroundColor: "var(--vscode-editor-background)",
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: "100%",
                backgroundColor: "var(--vscode-button-background)",
              }}
            ></div>
          </div>
        </div>
        <div
          style={{
            flex: "1 1 300px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Status Breakdown</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(statusStats).map(([status, count]) => (
              <li
                key={status}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                }}
              >
                {status}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div
          style={{
            flex: "1 1 300px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Risk Signals</h3>
          <p style={{ margin: "0 0 8px 0" }}>⚠️ Stale tasks (&gt; 7 days): <strong>{staleTasks}</strong></p>
          <p style={{ margin: 0 }}>
            🔥 Open high-priority tasks: <strong>{highPriorityOpen}</strong>
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        padding: "20px",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "20px",
          borderBottom: "1px solid var(--vscode-widget-border)",
          paddingBottom: "10px",
          flexShrink: 0,
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
          <h1 style={{ margin: 0, color: "var(--vscode-textLink-foreground)" }}>
            🚀 Lynvo
          </h1>
          <button
            onClick={() => setActiveView("board")}
            style={{
              background:
                activeView === "board"
                  ? "var(--vscode-button-background)"
                  : "transparent",
              color:
                activeView === "board" ? "white" : "var(--vscode-foreground)",
              border: "none",
              padding: "5px 10px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Board
          </button>
          <button
            onClick={() => setActiveView("insights")}
            style={{
              background:
                activeView === "insights"
                  ? "var(--vscode-button-background)"
                  : "transparent",
              color:
                activeView === "insights"
                  ? "white"
                  : "var(--vscode-foreground)",
              border: "none",
              padding: "5px 10px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Insights
          </button>
          <button
            onClick={() => setActiveView("labels")}
            style={{
              background:
                activeView === "labels"
                  ? "var(--vscode-button-background)"
                  : "transparent",
              color:
                activeView === "labels" ? "white" : "var(--vscode-foreground)",
              border: "none",
              padding: "5px 10px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Labels
          </button>

          <button
            onClick={triggerSync}
            disabled={isSyncing}
            style={{
              marginLeft: "10px",
              padding: "5px 10px",
              borderRadius: "4px",
              cursor: isSyncing ? "wait" : "pointer",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
              border: "1px solid var(--vscode-widget-border)",
              fontWeight: "bold",
            }}
          >
            {isSyncing ? "⏳ Syncing..." : "☁️ Sync Team"}
          </button>
        </div>

        {activeView === "board" && (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              placeholder="🔍 Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ padding: "6px", width: "200px" }}
            />
            <select
              value={activeFilterLabel}
              onChange={(e) => setActiveFilterLabel(e.target.value)}
              style={{ padding: "6px" }}
            >
              <option value="">🏷️ All Labels</option>
              {boardData?.labels &&
                Object.values(boardData.labels).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            {isFiltering && (
              <>
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--vscode-editorWarning-foreground)",
                  }}
                >
                  Drag & Drop disabled
                </span>
                <button onClick={clearFilters}>Clear</button>
              </>
            )}
          </div>
        )}
      </div>

      {boardData && activeView === "board" && (
        <div
          style={{
            display: "flex",
            gap: "20px",
            flex: 1,
            overflowX: "auto",
            alignItems: "flex-start",
            paddingBottom: "20px",
          }}
        >
          {Object.values(boardData.columns)
            .sort((a, b) => a.position - b.position)
            .map((col) => (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, col.id)}
                onDragEnter={() => {
                  dragOverTaskRef.current = null;
                }}
                style={{
                  flex: "0 0 320px",
                  backgroundColor:
                    "var(--vscode-editor-inactiveSelectionBackground)",
                  padding: "15px",
                  borderRadius: "8px",
                  height: "100%",
                  overflowY: "auto",
                  borderTop: `4px solid ${col.color}`,
                  boxSizing: "border-box",
                }}
              >
                {editingColId === col.id ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "5px",
                      marginBottom: "15px",
                      alignItems: "center",
                      backgroundColor: "var(--vscode-editor-background)",
                      padding: "8px",
                      borderRadius: "6px",
                    }}
                  >
                    <button
                      className="icon-btn"
                      onClick={() => moveColumn(col.id, "left")}
                    >
                      &lt;
                    </button>
                    <input
                      type="color"
                      value={editColColor}
                      onChange={(e) => setEditColColor(e.target.value)}
                      title="Pick column color"
                    />
                    <input
                      value={editColTitle}
                      onChange={(e) => setEditColTitle(e.target.value)}
                      style={{ flex: 1, padding: "4px", width: "100px" }}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => moveColumn(col.id, "right")}
                    >
                      &gt;
                    </button>
                    <button className="icon-btn" onClick={saveEditColumn}>
                      💾
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => setEditingColId(null)}
                    >
                      ❌
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "15px",
                      position: "sticky",
                      top: 0,
                      backgroundColor:
                        "var(--vscode-editor-inactiveSelectionBackground)",
                      zIndex: 1,
                      paddingBottom: "10px",
                      borderBottom: "1px solid var(--vscode-widget-border)",
                    }}
                  >
                    <h3 style={{ margin: 0 }}>{col.title}</h3>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        className="icon-btn"
                        onClick={() => startEditingColumn(col)}
                      >
                        ✏️
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() =>
                          vscode.postMessage({
                            command: "deleteColumn",
                            colId: col.id,
                          })
                        }
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )}

                {addingTaskColId === col.id ? (
                  <div
                    style={{
                      marginBottom: "15px",
                      padding: "10px",
                      backgroundColor: "var(--vscode-editor-background)",
                      borderRadius: "6px",
                      border: "1px solid var(--vscode-focusBorder)",
                    }}
                  >
                    <input
                      autoFocus
                      placeholder="Task title..."
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      style={{
                        width: "100%",
                        marginBottom: "8px",
                        padding: "5px",
                        boxSizing: "border-box",
                      }}
                    />
                    <textarea
                      placeholder="Description (optional)..."
                      value={newTaskDesc}
                      onChange={(e) => setNewTaskDesc(e.target.value)}
                      rows={2}
                      style={{
                        width: "100%",
                        marginBottom: "8px",
                        padding: "5px",
                        boxSizing: "border-box",
                      }}
                    />
                    {renderLabelSelector(newTaskLabels, setNewTaskLabels)}
                    <select
                      value={newTaskPriority}
                      onChange={(e) =>
                        setNewTaskPriority(
                          e.target.value as "low" | "medium" | "high",
                        )
                      }
                      style={{
                        width: "100%",
                        marginBottom: "8px",
                        padding: "5px",
                      }}
                    >
                      <option value="high">Priority: High</option>
                      <option value="medium">Priority: Medium</option>
                      <option value="low">Priority: Low</option>
                    </select>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => setAddingTaskColId(null)}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={submitNewTask}
                        style={{
                          flex: 1,
                          backgroundColor: "var(--vscode-button-background)",
                          color: "white",
                          border: "none",
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  !isFiltering && (
                    <button
                      onClick={() => openAddTaskForm(col.id)}
                      style={{
                        width: "100%",
                        padding: "6px",
                        marginBottom: "15px",
                        background: "transparent",
                        border: "1px dashed var(--vscode-widget-border)",
                        color: "var(--vscode-foreground)",
                        cursor: "pointer",
                        borderRadius: "4px",
                      }}
                    >
                      + Add Task here
                    </button>
                  )
                )}

                {getTasksByStatusFiltered(col.id).map(renderTaskCard)}
                {getTasksByStatusFiltered(col.id).length === 0 && (
                  <div
                    style={{
                      padding: "10px",
                      opacity: 0.7,
                      fontSize: "12px",
                      border: "1px dashed var(--vscode-widget-border)",
                      borderRadius: "6px",
                    }}
                  >
                    No tasks yet in this column.
                  </div>
                )}
              </div>
            ))}

          <div style={{ flex: "0 0 250px" }}>
            {isAddingColumn ? (
              <div
                style={{
                  backgroundColor:
                    "var(--vscode-editor-inactiveSelectionBackground)",
                  padding: "15px",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{ display: "flex", gap: "10px", marginBottom: "10px" }}
                >
                  <input
                    type="color"
                    value={newColColor}
                    onChange={(e) => setNewColColor(e.target.value)}
                  />
                  <input
                    autoFocus
                    placeholder="Column Name"
                    value={newColTitle}
                    onChange={(e) => setNewColTitle(e.target.value)}
                    style={{ flex: 1, padding: "4px" }}
                  />
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => setIsAddingColumn(false)}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNewColumn}
                    style={{
                      flex: 1,
                      backgroundColor: "var(--vscode-button-background)",
                      color: "white",
                      border: "none",
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingColumn(true)}
                style={{
                  width: "100%",
                  padding: "15px",
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                + Add another column
              </button>
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "insights" && renderInsights()}
      {boardData && activeView === "labels" && renderLabelsManager()}
    </div>
  );
};
