'use strict';

const clean = (value, limit) => typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').trim().slice(0, limit) : '';

function progressSynopsis(state) {
  const text = String(state.getUpdatedGameConsole?.() || '');
  const line = label => clean(text.match(new RegExp(`^${label}:[ \\t]*([^\\r\\n]*)`, 'm'))?.[1], 180);
  const tasks = state.getCurrentTasks?.() || [], index = state.getCurrentTaskIndex?.() || 0;
  const active = tasks[index];
  const synopsis = {
    destination: 'Hades; the final confrontation is Arithus in the Throne Room of Hades.',
    room: line('Room Name'), visitedRooms: line('Rooms Visited'),
    completedQuests: line('Quests Achieved'), artifacts: line('Artifacts Found'),
    quest: clean(state.getCurrentQuest?.() || line('Current Quest'), 500),
    boundBoss: line('Next Boss'), bossRoom: line('Next Boss Room'), bossCoordinates: line('Boss Room Coordinates'),
    completedSteps: tasks.filter(task => task?.status === 'Completed').slice(-3).map(task => clean(task.desc, 200)),
    activeStep: active ? { number: index + 1, status: clean(active.status, 24), goal: clean(active.desc, 300),
      verified: active.progress ? `${Number(active.progress.satisfied) || 0}/${Number(active.progress.total) || 0}` : 'not yet verified' } : null
  };
  return synopsis;
}

function progressPrompt(state) {
  return `Party journey synopsis (verified game state, not new adjudication): ${JSON.stringify(progressSynopsis(state))}. ` +
    'Keep the story coherent with these goals. Do not mark steps complete, grant items or XP, change the bound boss, or treat personal character recollections as verified facts.';
}

module.exports = { progressSynopsis, progressPrompt };
