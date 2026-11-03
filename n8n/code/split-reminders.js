// Turns the Convex response { reminders: [...] } into one item per reminder.
// An empty list ends the run quietly: nothing is overdue.
const reminders = Array.isArray($json.reminders) ? $json.reminders : [];
return reminders.map((reminder) => ({ json: reminder }));
