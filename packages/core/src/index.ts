export { addDays, type CalendarDate, type Weekday } from './calendar-date.ts';
export {
	estimateAcademicTerms,
	resolveAcademicTerms,
	type ResolvedTerm,
	type StoredTerm,
	type TermSource,
} from './academic-terms.ts';
export { DEFAULT_PERIODS, findPeriod, type Period } from './periods.ts';
export {
	INITIAL_SOURCE_HEALTH,
	MAX_BACKOFF_MS,
	UNHEALTHY_AFTER,
	isSourceDisabled,
	isUnhealthy,
	recordFailure,
	recordSuccess,
	shouldAttempt,
	type IntervalOptions,
	type SourceHealth,
} from './source-health.ts';
export {
	expandTimetable,
	type ClassChange,
	type Lesson,
	type LessonStatus,
	type Registration,
	type Slot,
	type SubstituteDay,
	type Term,
	type TermPeriod,
	type TimetableInput,
} from './timetable.ts';
export {
	resolveHolidays,
	type HolidaySource,
	type ResolvedHoliday,
	type ResolveHolidaysInput,
} from './holidays.ts';
