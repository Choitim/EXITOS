import { createContext } from 'react';

/**
 * True in the online demo: links inside the recorded plan's content (for example "Original Notion
 * page") are shown as plain text, because the content is synthetic and the pages do not exist.
 * False everywhere else.
 */
export const InertLinksContext = createContext(false);
