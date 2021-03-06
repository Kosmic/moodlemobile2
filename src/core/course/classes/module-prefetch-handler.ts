// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { TranslateService } from '@ngx-translate/core';
import { CoreAppProvider } from '@providers/app';
import { CoreFilepoolProvider } from '@providers/filepool';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreCourseProvider } from '../providers/course';
import { CoreCourseModulePrefetchHandler } from '../providers/module-prefetch-delegate';

/**
 * Base prefetch handler to be registered in CoreCourseModulePrefetchDelegate. Prefetch handlers should inherit either
 * from CoreCourseModuleActivityPrefetchHandlerBase or CoreCourseModuleResourcePrefetchHandlerBase, depending on whether
 * they are an activity or a resource. It's not recommended to inherit from this class directly.
 */
export class CoreCourseModulePrefetchHandlerBase implements CoreCourseModulePrefetchHandler {
    /**
     * Name of the handler.
     * @type {string}
     */
    name = 'CoreCourseModulePrefetchHandler';

    /**
     * Name of the module. It should match the "modname" of the module returned in core_course_get_contents.
     * @type {string}
     */
    modName = 'default';

    /**
     * The handler's component.
     * @type {string}
     */
    component = 'core_module';

    /**
     * The RegExp to check updates. If a module has an update whose name matches this RegExp, the module will be marked
     * as outdated. This RegExp is ignored if hasUpdates function is defined.
     * @type {RegExp}
     */
    updatesNames = /^.*files$/;

    /**
     * If true, this module will be ignored when determining the status of a list of modules. The module will
     * still be downloaded when downloading the section/course, it only affects whether the button should be displayed.
     * @type {boolean}
     */
    skipListStatus = false;

    /**
     * List of download promises to prevent downloading the module twice at the same time.
     * @type {{[s: string]: {[s: string]: Promise<any>}}}
     */
    protected downloadPromises: { [s: string]: { [s: string]: Promise<any> } } = {};

    constructor(protected translate: TranslateService, protected appProvider: CoreAppProvider, protected utils: CoreUtilsProvider,
            protected courseProvider: CoreCourseProvider, protected filepoolProvider: CoreFilepoolProvider,
            protected sitesProvider: CoreSitesProvider, protected domUtils: CoreDomUtilsProvider) { }

    /**
     * Add an ongoing download to the downloadPromises list. When the promise finishes it will be removed.
     *
     * @param {number} id Unique identifier per component.
     * @param {Promise<any>} promise Promise to add.
     * @param {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Promise of the current download.
     */
    addOngoingDownload(id: number, promise: Promise<any>, siteId?: string): Promise<any> {
        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        const uniqueId = this.getUniqueId(id);

        if (!this.downloadPromises[siteId]) {
            this.downloadPromises[siteId] = {};
        }

        this.downloadPromises[siteId][uniqueId] = promise.finally(() => {
            delete this.downloadPromises[siteId][uniqueId];
        });

        return this.downloadPromises[siteId][uniqueId];
    }

    /**
     * Download the module.
     *
     * @param {any} module The module object returned by WS.
     * @param {number} courseId Course ID.
     * @param {string} [dirPath] Path of the directory where to store all the content files.
     * @return {Promise<any>} Promise resolved when all content is downloaded.
     */
    download(module: any, courseId: number, dirPath?: string): Promise<any> {
        // To be overridden.
        return Promise.resolve();
    }

    /**
     * Returns a list of content files that can be downloaded.
     *
     * @param {any} module The module object returned by WS.
     * @return {any[]} List of files.
     */
    getContentDownloadableFiles(module: any): any[] {
        const files = [];

        if (module.contents && module.contents.length) {
            module.contents.forEach((content) => {
                if (this.isFileDownloadable(content)) {
                    files.push(content);
                }
            });
        }

        return files;
    }

    /**
     * Get the download size of a module.
     *
     * @param {any} module Module.
     * @param {Number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<{size: number, total: boolean}>} Promise resolved with the size and a boolean indicating if it was able
     *                                                   to calculate the total size.
     */
    getDownloadSize(module: any, courseId: number, single?: boolean): Promise<{ size: number, total: boolean }> {
        return this.getFiles(module, courseId).then((files) => {
            return this.utils.sumFileSizes(files);
        }).catch(() => {
            return { size: -1, total: false };
        });
    }

    /**
     * Get the downloaded size of a module. If not defined, we'll use getFiles to calculate it (it can be slow).
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {number|Promise<number>} Size, or promise resolved with the size.
     */
    getDownloadedSize(module: any, courseId: number): number | Promise<number> {
        const siteId = this.sitesProvider.getCurrentSiteId();

        return this.filepoolProvider.getFilesSizeByComponent(siteId, this.component, module.id);
    }

    /**
     * Get list of files. If not defined, we'll assume they're in module.contents.
     *
     * @param {any} module Module.
     * @param {Number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<any[]>} Promise resolved with the list of files.
     */
    getFiles(module: any, courseId: number, single?: boolean): Promise<any[]> {
        // To be overridden.
        return Promise.resolve([]);
    }

    /**
     * Returns module intro files.
     *
     * @param {any} module The module object returned by WS.
     * @param {number} courseId Course ID.
     * @param {boolean} [ignoreCache] True if it should ignore cached data (it will always fail in offline or server down).
     * @return {Promise<any[]>} Promise resolved with list of intro files.
     */
    getIntroFiles(module: any, courseId: number, ignoreCache?: boolean): Promise<any[]> {
        return Promise.resolve(this.getIntroFilesFromInstance(module));
    }

    /**
     * Returns module intro files from instance.
     *
     * @param {any} module The module object returned by WS.
     * @param {any} [instance] The instance to get the intro files (book, assign, ...). If not defined, module will be used.
     * @return {any[]} List of intro files.
     */
    getIntroFilesFromInstance(module: any, instance?: any): any[] {
        if (instance) {
            if (typeof instance.introfiles != 'undefined') {
                return instance.introfiles;
            } else if (instance.intro) {
                return this.domUtils.extractDownloadableFilesFromHtmlAsFakeFileObjects(instance.intro);
            }
        }

        if (module.description) {
            return this.domUtils.extractDownloadableFilesFromHtmlAsFakeFileObjects(module.description);
        }

        return [];
    }

    /**
     * If there's an ongoing download for a certain identifier return it.
     *
     * @param {number} id Unique identifier per component.
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Promise of the current download.
     */
    getOngoingDownload(id: number, siteId?: string): Promise<any> {
        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        if (this.isDownloading(id, siteId)) {
            // There's already a download ongoing, return the promise.
            return this.downloadPromises[siteId][this.getUniqueId(id)];
        }

        return Promise.resolve();
    }

    /**
     * Create unique identifier using component and id.
     *
     * @param {number} id Unique ID inside component.
     * @return {string} Unique ID.
     */
    getUniqueId(id: number): string {
        return this.component + '#' + id;
    }

    /**
     * Invalidate the prefetched content.
     *
     * @param {number} moduleId The module ID.
     * @param {number} courseId The course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when the data is invalidated.
     */
    invalidateContent(moduleId: number, courseId: number): Promise<any> {
        // To be overridden.
        return Promise.resolve();
    }

    /**
     * Invalidate WS calls needed to determine module status (usually, to check if module is downloadable).
     * It doesn't need to invalidate check updates. It should NOT invalidate files nor all the prefetched data.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when invalidated.
     */
    invalidateModule(module: any, courseId: number): Promise<any> {
        return this.courseProvider.invalidateModule(module.id);
    }

    /**
     * Check if a module can be downloaded. If the function is not defined, we assume that all modules are downloadable.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {boolean|Promise<boolean>} Whether the module can be downloaded. The promise should never be rejected.
     */
    isDownloadable(module: any, courseId: number): boolean | Promise<boolean> {
        // By default, mark all instances as downloadable.
        return true;
    }

    /**
     * Check if a there's an ongoing download for the given identifier.
     *
     * @param {number} id Unique identifier per component.
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {boolean} True if downloading, false otherwise.
     */
    isDownloading(id: number, siteId?: string): boolean {
        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        return !!(this.downloadPromises[siteId] && this.downloadPromises[siteId][this.getUniqueId(id)]);
    }

    /**
     * Whether or not the handler is enabled on a site level.
     *
     * @return {boolean|Promise<boolean>} A boolean, or a promise resolved with a boolean, indicating if the handler is enabled.
     */
    isEnabled(): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Check if a file is downloadable.
     *
     * @param {any} file File to check.
     * @return {boolean} Whether the file is downloadable.
     */
    isFileDownloadable(file: any): boolean {
        return file.type === 'file';
    }

    /**
     * Load module contents into module.contents if they aren't loaded already.
     *
     * @param {any} module Module to load the contents.
     * @param {number} [courseId] The course ID. Recommended to speed up the process and minimize data usage.
     * @param {boolean} [ignoreCache] True if it should ignore cached data (it will always fail in offline or server down).
     * @return {Promise}           Promise resolved when loaded.
     */
    loadContents(module: any, courseId: number, ignoreCache?: boolean): Promise<void> {
        // To be overridden.
        return Promise.resolve();
    }

    /**
     * Prefetch a module.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @param {string} [dirPath] Path of the directory where to store all the content files.
     * @return {Promise<any>} Promise resolved when done.
     */
    prefetch(module: any, courseId?: number, single?: boolean, dirPath?: string): Promise<any> {
        // To be overridden.
        return Promise.resolve();
    }

    /**
     * Remove module downloaded files. If not defined, we'll use getFiles to remove them (slow).
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when done.
     */
    removeFiles(module: any, courseId: number): Promise<any> {
        return this.filepoolProvider.removeFilesByComponent(this.sitesProvider.getCurrentSiteId(), this.component, module.id);
    }
}
