import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LynvoBoard, LynvoColumn, LynvoTask } from "../types";

declare const acquireVsCodeApi: () => { postMessage: (msg: any) => void };
const vscode = acquireVsCodeApi();

type LynvoView = "board" | "insights" | "labels";

type Priority = "low" | "medium" | "high";

const priorityColors: Record<Priority, string> = {
  low: "#3fb950",
  medium: "#d29922",
  high: "#f85149",
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const toDateInputValue = (timestamp?: number) => {
  if (!timestamp) return "";
  const dt = new Date(timestamp);
  const year = dt.getFullYear();
  const month = `${dt.getMonth() + 1}`.padStart(2, "0");
  const day = `${dt.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromDateInputValue = (value: string): number | undefined => {
  if (!value) return undefined;
  const ts = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
};

const getTaskPriority = (task: LynvoTask): Priority => task.priority || "medium";

export const App: React.FC = () => {
  const [boardData, setBoardData] = useState<LynvoBoard | null>(null);
  const [activeView, setActiveView] = useState<LynvoView>("board");

  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>("");
  const [activePriorityFilter, setActivePriorityFilter] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState(false);

  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("medium");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [editDueDate, setEditDueDate] = useState("");

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#007acc");

  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColTitle, setEditColTitle] = useState("");
  const [editColColor, setEditColColor] = useState("");

  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#f85149");

  const draggedTaskRef = useRef<string | null>(null);
  const draggedFromColumnRef = useRef<string | null>(null);
  const dragOverTaskRef = useRef<string | null>(null);

  const isFiltering =
    searchTerm.trim().length > 0 ||
    activeFilterLabel !== "" ||
    activePriorityFilter !== "";

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === "loadData") {
        setBoardData(event.data.data);
        setIsSyncing(false);
      }

      if (event.data.command === "switchView" && event.data.view) {
        setActiveView(event.data.view as LynvoView);
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "requestData" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const sortedColumns = useMemo(
    () =>
      boardData
        ? Object.values(boardData.columns).sort((a, b) => a.position - b.position)
        : [],
    [boardData],
  );

  const tasks = useMemo(() => Object.values(boardData?.tasks || {}), [boardData]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const doneIds = sortedColumns
      .filter((col) => col.title.toLowerCase().includes("done"))
      .map((col) => col.id);
    const completed = tasks.filter((task) => doneIds.includes(task.status)).length;
    const overdue = tasks.filter(
      (task) => task.dueDate && task.dueDate < now && !doneIds.includes(task.status),
    ).length;
    const stale = tasks.filter((task) => now - task.updatedAt > 1000 * 60 * 60 * 24 * 7).length;

    return {
      total: tasks.length,
      completed,
      completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
      overdue,
      stale,
      inProgress: tasks.filter((task) =>
        sortedColumns
          .find((col) => col.id === task.status)
          ?.title.toLowerCase()
          .includes("progress"),
      ).length,
    };
  }, [tasks, sortedColumns]);

  const triggerSync = () => {
    setIsSyncing(true);
    vscode.postMessage({ command: "syncBoard" });
  };

  const handleDragStart = (e: React.DragEvent, task: LynvoTask) => {
    if (editingTaskId === task.id || isFiltering) {
      e.preventDefault();
      return;
    }

    draggedTaskRef.current = task.id;
    draggedFromColumnRef.current = task.status;
    e.dataTransfer.setData("taskId", task.id);
  };

  const getColumnSortedTasks = (
    board: LynvoBoard,
    colId: string,
    excludedTaskId?: string,
  ) =>
    Object.values(board.tasks)
      .filter((task) => task.status === colId && task.id !== excludedTaskId)
      .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (isFiltering || !boardData) return;

    const taskId = draggedTaskRef.current;
    const sourceStatus = draggedFromColumnRef.current;
    const targetId = dragOverTaskRef.current;
    if (!taskId || !sourceStatus || !boardData.tasks[taskId]) return;

    const nextBoard: LynvoBoard = {
      ...boardData,
      tasks: { ...boardData.tasks },
    };

    nextBoard.tasks[taskId] = { ...nextBoard.tasks[taskId], status: newStatus };

    const targetTasks = getColumnSortedTasks(nextBoard, newStatus, taskId);
    const droppedTask = nextBoard.tasks[taskId];
    const targetIdx = targetTasks.findIndex((task) => task.id === targetId);

    if (targetIdx < 0) {
      targetTasks.push(droppedTask);
    } else {
      targetTasks.splice(targetIdx, 0, droppedTask);
    }

    const sourceTasks =
      sourceStatus === newStatus
        ? targetTasks
        : getColumnSortedTasks(nextBoard, sourceStatus, taskId);

    const updates = [
      ...targetTasks.map((task, idx) => ({
        id: task.id,
        status: newStatus,
        position: idx,
        isDraggedTask: task.id === taskId,
      })),
      ...(sourceStatus === newStatus
        ? []
        : sourceTasks.map((task, idx) => ({
            id: task.id,
            status: sourceStatus,
            position: idx,
          }))),
    ];

    setBoardData(nextBoard);
    vscode.postMessage({ command: "reorderTasks", updates });
    draggedTaskRef.current = null;
    draggedFromColumnRef.current = null;
    dragOverTaskRef.current = null;
  };

  const openAddTaskForm = (colId: string) => {
    setAddingTaskColId(colId);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskLabels([]);
    setNewTaskPriority("medium");
    setNewTaskDueDate("");
  };

  const submitNewTask = () => {
    if (!newTaskTitle.trim() || !addingTaskColId) return;

    vscode.postMessage({
      command: "createTask",
      title: newTaskTitle.trim(),
      description: newTaskDesc,
      targetColId: addingTaskColId,
      labelIds: newTaskLabels,
      priority: newTaskPriority,
      dueDate: fromDateInputValue(newTaskDueDate),
    });
    setAddingTaskColId(null);
  };

  const startEditingTask = (task: LynvoTask) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditLabelIds(task.labelIds || []);
    setEditPriority(getTaskPriority(task));
    setEditDueDate(toDateInputValue(task.dueDate));
  };

  const saveEditTask = () => {
    if (!editTitle.trim() || !editingTaskId) return;

    vscode.postMessage({
      command: "editTask",
      taskId: editingTaskId,
      title: editTitle.trim(),
      description: editDesc,
      labelIds: editLabelIds,
      priority: editPriority,
      dueDate: fromDateInputValue(editDueDate),
    });
    setEditingTaskId(null);
  };

  const toggleLabelSelection = (
    labelId: string,
    current: string[],
    setter: (val: string[]) => void,
  ) => {
    if (current.includes(labelId)) setter(current.filter((id) => id !== labelId));
    else setter([...current, labelId]);
  };

  const submitNewColumn = () => {
    if (!newColTitle.trim()) return;

    vscode.postMessage({
      command: "createColumn",
      title: newColTitle.trim(),
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
      title: editColTitle.trim(),
      color: editColColor,
    });
    setEditingColId(null);
  };

  const moveColumn = (colId: string, direction: "left" | "right") => {
    if (!boardData) return;

    const cols = [...sortedColumns];
    const idx = cols.findIndex((c) => c.id === colId);
    const swapIndex = direction === "left" ? idx - 1 : idx + 1;

    if (idx < 0 || swapIndex < 0 || swapIndex >= cols.length) return;

    const currentPosition = cols[idx].position;
    cols[idx].position = cols[swapIndex].position;
    cols[swapIndex].position = currentPosition;

    const updates = cols.map((c) => ({ id: c.id, position: c.position }));
    setBoardData({
      ...boardData,
      columns: Object.fromEntries(cols.map((c) => [c.id, c])),
    });
    vscode.postMessage({ command: "reorderColumns", updates });
  };

  const getTasksByStatusFiltered = (status: string): LynvoTask[] => {
    if (!boardData || !boardData.tasks) return [];

    return tasks
      .filter((task) => task.status === status)
      .filter(
        (task) =>
          !searchTerm ||
          task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          task.description.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      .filter(
        (task) =>
          !activeFilterLabel ||
          (task.labelIds && task.labelIds.includes(activeFilterLabel)),
      )
      .filter(
        (task) =>
          !activePriorityFilter || getTaskPriority(task) === activePriorityFilter,
      )
      .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
  };

  const renderLabelSelector = (
    selected: string[],
    setter: (val: string[]) => void,
  ) => {
    if (!boardData || !boardData.labels) return null;

    return (
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "8px" }}>
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
    const priority = getTaskPriority(task);
    const dueDate = task.dueDate;
    const isOverdue = Boolean(dueDate && dueDate < Date.now());

    return (
      <div
        key={task.id}
        draggable={!isEditing && !isFiltering}
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnter={() => {
          dragOverTaskRef.current = task.id;
        }}
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-widget-border)",
          padding: "12px",
          marginBottom: "10px",
          borderRadius: "8px",
          position: "relative",
          opacity: isFiltering ? 0.9 : 1,
          boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
        }}
      >
        {isEditing ? (
          <div>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ width: "100%", marginBottom: "8px", padding: "6px", boxSizing: "border-box" }}
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              style={{ width: "100%", marginBottom: "8px", padding: "6px", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as Priority)}
                style={{ flex: 1, padding: "6px" }}
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                style={{ flex: 1, padding: "6px" }}
              />
            </div>
            {renderLabelSelector(editLabelIds, setEditLabelIds)}
            <div style={{ display: "flex", gap: "5px", justifyContent: "flex-end" }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
              <div style={{ position: "absolute", top: "8px", right: "8px", display: "flex", gap: "2px" }}>
                <button className="icon-btn" onClick={() => startEditingTask(task)}>
                  ✏️
                </button>
                <button
                  className="icon-btn delete"
                  onClick={() => vscode.postMessage({ command: "deleteTask", taskId: task.id })}
                >
                  🗑️
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: "10px",
                  borderRadius: "10px",
                  padding: "2px 8px",
                  border: `1px solid ${priorityColors[priority]}`,
                  color: priorityColors[priority],
                }}
              >
                {priority.toUpperCase()}
              </span>
              {dueDate && (
                <span
                  style={{
                    fontSize: "10px",
                    borderRadius: "10px",
                    padding: "2px 8px",
                    border: `1px solid ${isOverdue ? "#f85149" : "var(--vscode-widget-border)"}`,
                    color: isOverdue ? "#f85149" : "var(--vscode-descriptionForeground)",
                  }}
                >
                  📅 {new Date(dueDate).toLocaleDateString()}
                </span>
              )}
            </div>

            {task.labelIds && task.labelIds.length > 0 && (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px" }}>
                {task.labelIds.map((id) => {
                  const label = boardData?.labels?.[id];
                  if (!label) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        backgroundColor: label.color,
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: "8px",
                        fontSize: "10px",
                      }}
                    >
                      {label.name}
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
                    filePath: task.codeReference?.filePath,
                    lineStart: task.codeReference?.lineStart,
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
                🔗 {task.codeReference.filePath.split("/").pop()} (L: {task.codeReference.lineStart})
              </div>
            )}
            <p
              style={{
                fontSize: "12px",
                opacity: 0.85,
                margin: "0 0 10px 0",
                color: "var(--vscode-descriptionForeground)",
                whiteSpace: "pre-wrap",
              }}
            >
              {task.description}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "10px",
                opacity: 0.75,
                color: "var(--vscode-textLink-foreground)",
              }}
            >
              <span>👤 {task.lastModifiedBy?.username}</span>
              <div style={{ textAlign: "right", color: "var(--vscode-descriptionForeground)" }}>
                <div>🕒 {formatDateTime(task.createdAt)}</div>
                {isEdited && <div>✎ {formatDateTime(task.updatedAt)}</div>}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderLabelsManager = () => (
    <div style={{ padding: "20px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px" }}>
      <h2>Manage Labels</h2>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center" }}>
        <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} />
        <input
          placeholder="New label name..."
          value={newLabelName}
          onChange={(e) => setNewLabelName(e.target.value)}
          style={{ padding: "6px" }}
        />
        <button
          onClick={() => {
            if (!newLabelName.trim()) return;
            vscode.postMessage({ command: "createLabel", name: newLabelName.trim(), color: newLabelColor });
            setNewLabelName("");
          }}
          style={{ padding: "6px 12px", backgroundColor: "var(--vscode-button-background)", color: "white", border: "none", cursor: "pointer" }}
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
                onClick={() => vscode.postMessage({ command: "deleteLabel", labelId: label.id })}
              >
                🗑️ Delete
              </button>
            </div>
          ))}
      </div>
    </div>
  );

  const renderInsights = () => {
    if (!boardData) return null;

    const statusStats = tasks.reduce(
      (acc, task) => {
        const colTitle = boardData.columns[task.status]?.title || "Unknown";
        acc[colTitle] = (acc[colTitle] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const priorityStats = tasks.reduce(
      (acc, task) => {
        const key = getTaskPriority(task);
        acc[key] += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 } as Record<Priority, number>,
    );

    return (
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", overflowY: "auto" }}>
        <div style={{ flex: "1 1 100%", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h2 style={{ marginTop: 0 }}>Project Progress</h2>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span>
              {metrics.completed} of {metrics.total} tasks completed
            </span>
            <span style={{ fontWeight: "bold" }}>{metrics.completionRate}%</span>
          </div>
          <div style={{ width: "100%", height: "12px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "6px", overflow: "hidden" }}>
            <div
              style={{
                width: `${metrics.completionRate}%`,
                height: "100%",
                backgroundColor: "var(--vscode-button-background)",
              }}
            ></div>
          </div>
        </div>

        <div style={{ flex: "1 1 320px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h3 style={{ marginTop: 0 }}>Status Breakdown</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(statusStats).map(([status, count]) => (
              <li key={status} style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
                {status}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: "1 1 320px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h3 style={{ marginTop: 0 }}>Risk Metrics</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
              🔴 Overdue tasks: <strong>{metrics.overdue}</strong>
            </li>
            <li style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
              🟡 Stale (&gt;7 days): <strong>{metrics.stale}</strong>
            </li>
            <li style={{ padding: "8px 0" }}>
              🧭 In progress: <strong>{metrics.inProgress}</strong>
            </li>
          </ul>

          <h4 style={{ marginTop: "16px", marginBottom: "8px" }}>Priority Distribution</h4>
          {(["high", "medium", "low"] as Priority[]).map((priority) => (
            <div key={priority} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span style={{ color: priorityColors[priority] }}>{priority.toUpperCase()}</span>
                <span>{priorityStats[priority]}</span>
              </div>
              <div style={{ width: "100%", height: "8px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "5px" }}>
                <div
                  style={{
                    width: `${tasks.length ? Math.round((priorityStats[priority] / tasks.length) * 100) : 0}%`,
                    height: "8px",
                    borderRadius: "5px",
                    backgroundColor: priorityColors[priority],
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: "20px", height: "100vh", display: "flex", flexDirection: "column", boxSizing: "border-box", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px" }}>
        <div style={{ background: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px", padding: "10px" }}>
          <div style={{ fontSize: "11px", opacity: 0.8 }}>Total tasks</div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>{metrics.total}</div>
        </div>
        <div style={{ background: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px", padding: "10px" }}>
          <div style={{ fontSize: "11px", opacity: 0.8 }}>Completed</div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>{metrics.completed}</div>
        </div>
        <div style={{ background: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px", padding: "10px" }}>
          <div style={{ fontSize: "11px", opacity: 0.8 }}>Overdue</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: metrics.overdue ? "#f85149" : "inherit" }}>
            {metrics.overdue}
          </div>
        </div>
        <div style={{ background: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px", padding: "10px" }}>
          <div style={{ fontSize: "11px", opacity: 0.8 }}>Completion rate</div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>{metrics.completionRate}%</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--vscode-widget-border)", paddingBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, color: "var(--vscode-textLink-foreground)", fontSize: "24px" }}>🚀 Lynvo</h1>
          {([
            { id: "board", label: "Board" },
            { id: "insights", label: "Insights" },
            { id: "labels", label: "Labels" },
          ] as { id: LynvoView; label: string }[]).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              style={{
                background:
                  activeView === item.id
                    ? "var(--vscode-button-background)"
                    : "transparent",
                color: activeView === item.id ? "white" : "var(--vscode-foreground)",
                border: "1px solid var(--vscode-widget-border)",
                padding: "5px 10px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}

          <button
            onClick={triggerSync}
            disabled={isSyncing}
            style={{
              marginLeft: "4px",
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
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="🔍 Search tasks..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: "6px", width: "200px" }} />
            <select value={activeFilterLabel} onChange={(e) => setActiveFilterLabel(e.target.value)} style={{ padding: "6px" }}>
              <option value="">🏷️ All Labels</option>
              {boardData?.labels &&
                Object.values(boardData.labels).map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
            </select>
            <select value={activePriorityFilter} onChange={(e) => setActivePriorityFilter(e.target.value)} style={{ padding: "6px" }}>
              <option value="">⚡ All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {isFiltering && <span style={{ fontSize: "10px", color: "var(--vscode-editorWarning-foreground)" }}>Drag & Drop disabled</span>}
          </div>
        )}
      </div>

      {boardData && activeView === "board" && (
        <div style={{ display: "flex", gap: "20px", flex: 1, overflowX: "auto", alignItems: "flex-start", paddingBottom: "20px" }}>
          {sortedColumns.map((col) => {
            const columnTasks = getTasksByStatusFiltered(col.id);

            return (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, col.id)}
                onDragEnter={() => {
                  dragOverTaskRef.current = null;
                }}
                style={{
                  flex: "0 0 320px",
                  backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                  padding: "15px",
                  borderRadius: "8px",
                  height: "100%",
                  overflowY: "auto",
                  borderTop: `4px solid ${col.color}`,
                  boxSizing: "border-box",
                }}
              >
                {editingColId === col.id ? (
                  <div style={{ display: "flex", gap: "5px", marginBottom: "15px", alignItems: "center", backgroundColor: "var(--vscode-editor-background)", padding: "8px", borderRadius: "6px" }}>
                    <button className="icon-btn" onClick={() => moveColumn(col.id, "left")}>◀</button>
                    <input type="color" value={editColColor} onChange={(e) => setEditColColor(e.target.value)} title="Pick column color" />
                    <input value={editColTitle} onChange={(e) => setEditColTitle(e.target.value)} style={{ flex: 1, padding: "4px", width: "100px" }} />
                    <button className="icon-btn" onClick={() => moveColumn(col.id, "right")}>▶</button>
                    <button className="icon-btn" onClick={saveEditColumn}>💾</button>
                    <button className="icon-btn" onClick={() => setEditingColId(null)}>❌</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", position: "sticky", top: 0, backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", zIndex: 1, paddingBottom: "10px", borderBottom: "1px solid var(--vscode-widget-border)" }}>
                    <h3 style={{ margin: 0, display: "flex", gap: "8px", alignItems: "center" }}>
                      <span>{col.title}</span>
                      <span style={{ fontSize: "11px", opacity: 0.7 }}>({columnTasks.length})</span>
                    </h3>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button className="icon-btn" onClick={() => startEditingColumn(col)}>✏️</button>
                      <button className="icon-btn delete" onClick={() => vscode.postMessage({ command: "deleteColumn", colId: col.id })}>🗑️</button>
                    </div>
                  </div>
                )}

                {addingTaskColId === col.id ? (
                  <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "6px", border: "1px solid var(--vscode-focusBorder)" }}>
                    <input autoFocus placeholder="Task title..." value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} style={{ width: "100%", marginBottom: "8px", padding: "5px", boxSizing: "border-box" }} />
                    <textarea placeholder="Description (optional)..." value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} rows={2} style={{ width: "100%", marginBottom: "8px", padding: "5px", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                      <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value as Priority)} style={{ flex: 1, padding: "6px" }}>
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                      </select>
                      <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} style={{ flex: 1, padding: "6px" }} />
                    </div>
                    {renderLabelSelector(newTaskLabels, setNewTaskLabels)}
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button onClick={() => setAddingTaskColId(null)} style={{ flex: 1 }}>Cancel</button>
                      <button onClick={submitNewTask} style={{ flex: 1, backgroundColor: "var(--vscode-button-background)", color: "white", border: "none" }}>Save</button>
                    </div>
                  </div>
                ) : (
                  !isFiltering && <button onClick={() => openAddTaskForm(col.id)} style={{ width: "100%", padding: "6px", marginBottom: "15px", background: "transparent", border: "1px dashed var(--vscode-widget-border)", color: "var(--vscode-foreground)", cursor: "pointer", borderRadius: "4px" }}>+ Add Task here</button>
                )}

                {columnTasks.map(renderTaskCard)}
              </div>
            );
          })}

          <div style={{ flex: "0 0 250px" }}>
            {isAddingColumn ? (
              <div style={{ backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "15px", borderRadius: "8px" }}>
                <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                  <input type="color" value={newColColor} onChange={(e) => setNewColColor(e.target.value)} />
                  <input autoFocus placeholder="Column Name" value={newColTitle} onChange={(e) => setNewColTitle(e.target.value)} style={{ flex: 1, padding: "4px" }} />
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => setIsAddingColumn(false)} style={{ flex: 1 }}>Cancel</button>
                  <button onClick={submitNewColumn} style={{ flex: 1, backgroundColor: "var(--vscode-button-background)", color: "white", border: "none" }}>Create</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setIsAddingColumn(true)} style={{ width: "100%", padding: "15px", background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>+ Add another column</button>
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "insights" && renderInsights()}
      {boardData && activeView === "labels" && renderLabelsManager()}
    </div>
  );
};
