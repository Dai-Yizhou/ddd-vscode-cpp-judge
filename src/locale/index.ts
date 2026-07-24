import zhCN from './zh-CN';
import enUS from './en-US';

export interface LocaleStrings {
    run: string;
    runTitle: string;
    cppStandard: string;
    cppStandardTitle: string;
    optimizationLevel: string;
    optimizationLevelTitle: string;
    warningLevel: string;
    warningLevelTitle: string;
    softTimeLimit: string;
    softTimeLimitTitle: string;
    softMemoryLimit: string;
    softMemoryLimitTitle: string;
    sourceFile: string;
    help: string;
    helpTitle: string;
    settings: string;
    settingsTitle: string;
    settingsJson: string;
    settingsJsonTitle: string;
    ready: string;
    running: string;
    input: string;
    inputPlaceholder: string;
    loadInput: string;
    loadInputTitle: string;
    clearFile: string;
    clearFileTitle: string;
    expectedOutput: string;
    expectedPlaceholder: string;
    loadExpected: string;
    loadExpectedTitle: string;
    actualOutput: string;
    output: string;
    diff: string;
    stderr: string;
    outputPlaceholder: string;
    noStderr: string;
    noOutput: string;
    diffPlaceholder: string;
    status: string;
    time: string;
    memory: string;
    exitCode: string;
    match: string;
    fileIo: string;
    ac: string;
    wa: string;
    re: string;
    tle: string;
    mle: string;
    ce: string;
    compileError: string;
    runningElipsis: string;
    matchOk: string;
    matchSkip: string;
    matchDiff: string;
    consistent: string;
    inconsistent: string;
    largeFilePreview: string;
    manual: string;
    auto: string;
    unknown: string;
    deviceGB6: string;
    judgeMachine: string;
    baselineLuogu: string;
    baselineCcf: string;
    loading: string;
    loadingFail: string;
    dropInput: string;
    dropExpected: string;
    dropUnknown: string;
    fileTooLarge: string;
    fileLoadFail: string;
    helpTitleModal: string;
    helpClose: string;
    helpLoading: string;
}

export type LocaleCode = 'zh-CN' | 'en-US';

const DEFAULT_LOCALE: LocaleCode = 'zh-CN';

const LOCALE_DATA: Record<LocaleCode, LocaleStrings> = {
    'zh-CN': zhCN,
    'en-US': enUS
};

let currentLocale: LocaleCode = DEFAULT_LOCALE;

export function getLocale(): LocaleCode {
    return currentLocale;
}

export function setLocale(locale: LocaleCode): void {
    currentLocale = locale;
}

export function getStrings(): LocaleStrings {
    return LOCALE_DATA[currentLocale] || LOCALE_DATA[DEFAULT_LOCALE];
}

export function t(key: keyof LocaleStrings): string {
    return getStrings()[key];
}
