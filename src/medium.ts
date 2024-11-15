// Copyright 2015 A Medium Corporation
// Copyright 2024 Ritvik Nag

import {
    CreatePostRequest,
    Post,
    PostContentFormat,
    PostLicense,
    PostPublishStatus,
    PublishedPost,
    User,
} from './types';

const DEFAULT_ERROR_CODE = -1;
const DEFAULT_TIMEOUT_MS = 5000;

const {
    // INPUT_MARKDOWN_FILE,
    // INPUT_BASE_URL,
    // INPUT_POST_URL,
    MEDIUM_USER_ID,
    MEDIUM_USER_NAME,
    MEDIUM_ACCESS_TOKEN,
    MEDIUM_POST_STATUS = PostPublishStatus.DRAFT,
    MEDIUM_POST_LICENSE = PostLicense.ALL_RIGHTS_RESERVED,
} = process.env;

/**
 * An error with a code.
 */
class MediumError extends Error {
    code: number;

    constructor(message: string, code: number) {
        super(message);
        this.code = code;
    }
}

/**
 * The core client.
 */
class MediumClient {
    private readonly _accessToken: string;
    private _userId: string | null;
    private _userName: string | null;

    /**
     * Sets an access token on the client used for making requests.
     */
    constructor(
        accessToken: string | undefined = MEDIUM_ACCESS_TOKEN
    ) {
        this._accessToken = accessToken!;
        this._userId = MEDIUM_USER_ID || null;
        this._userName = MEDIUM_USER_NAME || null;
    }

    /**
     * Returns the details of the user associated with the current
     * access token.
     *
     * Requires the current access token to have the basicProfile scope.
     */
    async getUser(): Promise<User> {
        const user: User = await this._makeRequest({
            method: 'GET',
            path: '/v1/me',
        });
        this._userId = user.id;
        this._userName = user.name;
        return user;
    }

    /**
     * Returns the publications related to the current user.
     *
     * Requires the current access token to have the
     * listPublications scope.
     */
    async getPublicationsForUser(options: {
        userId: string;
    }): Promise<any> {
        this._enforce(options, ['userId']);
        return this._makeRequest({
            method: 'GET',
            path: `/v1/users/${options.userId}/publications`,
        });
    }

    /**
     * Returns the contributors for a chosen publication.
     *
     * Requires the current access token to have the basicProfile scope.
     */
    async getContributorsForPublication(options: {
        publicationId: string;
    }): Promise<any> {
        this._enforce(options, ['publicationId']);
        return this._makeRequest({
            method: 'GET',
            path: `/v1/publications/${options.publicationId}/contributors`,
        });
    }

    /**
     * Creates a post on Medium.
     *
     * Requires the current access token to have the publishPost scope.
     */
    async createPost({
        title,
        content,
        userId,
        tags,
        canonicalUrl,
        license = <PostLicense>MEDIUM_POST_LICENSE,
        publishedAt,
        publishStatus = <PostPublishStatus>MEDIUM_POST_STATUS,
        contentFormat = PostContentFormat.MARKDOWN,
    }: CreatePostRequest): Promise<Post> {
        // If `user id` is not provided, use the current user.
        if (!userId) ({ id: userId } = await this.getUser());

        return await this._createPost({
            canonicalUrl,
            content,
            contentFormat,
            license,
            publishedAt,
            publishStatus,
            tags,
            title,
            userId,
        });
    }

    /**
     * Creates a post on Medium.
     *
     * Requires the current access token to have the publishPost scope.
     */
    private async _createPost(
        options: CreatePostRequest
    ): Promise<Post> {
        this._enforce(options, ['userId']);

        return this._makeRequest({
            method: 'POST',
            path: `/v1/users/${options.userId}/posts`,
            data: {
                canonicalUrl: options.canonicalUrl,
                content: options.content,
                contentFormat: options.contentFormat,
                license: options.license,
                publishedAt: options.publishedAt,
                publishStatus: options.publishStatus,
                tags: options.tags,
                title: options.title,
            },
        });
    }

    /**
     * Creates a post on Medium and places it under the specified publication.
     *
     * Requires the current access token to have the publishPost scope.
     */
    async createPostInPublication(options: {
        userId: string;
        publicationId: string;
        title: string;
        contentFormat: PostContentFormat;
        content: string;
        tags: string[];
        canonicalUrl: string;
        publishedAt?: string;
        publishStatus: PostPublishStatus;
        license: PostLicense;
    }): Promise<Post> {
        this._enforce(options, ['publicationId']);

        return this._makeRequest({
            method: 'POST',
            path: `/v1/publications/${options.publicationId}/posts`,
            data: {
                title: options.title,
                content: options.content,
                contentFormat: options.contentFormat,
                tags: options.tags,
                canonicalUrl: options.canonicalUrl,
                publishedAt: options.publishedAt,
                publishStatus: options.publishStatus,
                license: options.license,
            },
        });
    }

    /**
     * Enforces that the given options object (first param) defines
     * all keys requested (second param). Raises an error if any
     * is missing.
     */
    private _enforce(options: any, requiredKeys: string[]): void {
        if (!options) {
            throw new MediumError(
                'Parameters for this call are undefined',
                DEFAULT_ERROR_CODE
            );
        }
        requiredKeys.forEach((requiredKey) => {
            if (!options[requiredKey])
                throw new MediumError(
                    `Missing required parameter "${requiredKey}"`,
                    DEFAULT_ERROR_CODE
                );
        });
    }

    /**
     * Makes a request to the Medium API.
     */
    private async _makeRequest(options: any): Promise<any> {
        const requestParams: RequestInit = {
            method: options.method,
            headers: {
                'Content-Type':
                    options.contentType || 'application/json',
                Authorization: `Bearer ${this._accessToken}`,
                Accept: 'application/json',
                'Accept-Charset': 'utf-8',
            },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        };

        if (options.data) {
            requestParams.body = JSON.stringify(options.data);
        }

        try {
            const response = await fetch(
                `https://api.medium.com${options.path}`,
                requestParams
            );

            const payload = await response.json();

            const statusType = Math.floor(response.status / 100);

            if (statusType === 4 || statusType === 5) {
                const err = payload.errors[0];
                throw new MediumError(err.message, err.code);
            } else if (statusType === 2) {
                return payload.data || payload;
            } else {
                throw new MediumError(
                    'Unexpected response',
                    DEFAULT_ERROR_CODE
                );
            }
        } catch (err: any) {
            console.log(`Error: ${err}`);
            throw new MediumError(err.toString(), DEFAULT_ERROR_CODE);
        }
    }

    /**
     * Retrieve the published posts
     * under a Medium username.
     *
     * For example, given a profile URL at:
     *   https://medium.com/@my-user
     *
     * Username can be either `@my-user` or `my-user` (in this example).
     *
     * @param username Medium user to retrieve published posts for.
     */
    async getPosts(username: string): Promise<PublishedPost[]> {
        let next: number = 0,
            allPosts: PublishedPost[] = [],
            posts: PublishedPost[];

        while (next != null) {
            ({ posts, next } = await this._getPosts(username, next));
            allPosts.push(...posts);
        }

        return allPosts;
    }

    /**
     * Retrieve the **titles** of published posts
     * under a Medium username.
     *
     * For example, given a profile URL at:
     *   https://medium.com/@my-user
     *
     * Username can be either `@my-user` or `my-user` (in this example).
     *
     * @param username Medium user to retrieve published posts for.
     */
    async getPostTitles(username: string): Promise<string[]> {
        let next: number = 0,
            allPosts: string[] = [],
            posts: string[];

        while (next != null) {
            ({ posts, next } = await this._getPostTitles(
                username,
                next
            ));
            allPosts.push(...posts);
        }

        return allPosts;
    }

    private async _getPosts(username: string, page: number) {
        let graphqlBody = {
            operationName: 'UserStreamOverview',
            query: graphqlQuery,
            variables: {
                userId: username,
                pagingOptions: {
                    limit: pageLimit,
                    page: null,
                    source: null,
                    to: page ? String(page) : String(Date.now()),
                    ignoredIds: null,
                },
            },
        };

        let resp = await fetch('https://medium.com/_/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(graphqlBody),
        });

        // NOTE: strip non-post items and strip description fields
        let resp_data = await resp.json();
        let author: string = resp_data.data.user.name;
        // noinspection JSUnresolvedReference
        let posts: PublishedPost[] =
            resp_data.data.user.profileStreamConnection.stream
                .map((stream: any) => {
                    // noinspection JSUnresolvedReference
                    return stream.itemType.post;
                })
                .map((post: any) => {
                    // noinspection JSUnresolvedReference
                    return {
                        id: post.id,
                        title: post.title,
                        link: post.mediumUrl,
                        pubDate: post.firstPublishedAt,
                        categories: post.tags.map(
                            (tag_obj: any) => tag_obj.id
                        ),
                    };
                });

        // noinspection JSUnresolvedReference
        const next: number =
            posts.length === pageLimit
                ? resp_data.data.user.profileStreamConnection
                      .pagingInfo.next.to
                : null;

        return {
            author,
            posts,
            next,
        };
    }

    private async _getPostTitles(username: string, page: number) {
        let graphqlBody = {
            operationName: 'UserStreamOverview',
            query: graphqlQueryMin,
            variables: {
                userId: username,
                pagingOptions: {
                    limit: pageLimit,
                    to: page ? String(page) : String(Date.now()),
                },
            },
        };

        let resp = await fetch('https://medium.com/_/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(graphqlBody),
        });

        // NOTE: strip non-post items and strip description fields
        let resp_data = await resp.json();
        // noinspection JSUnresolvedReference
        let posts: string[] =
            resp_data.data.user.profileStreamConnection.stream
                .map((stream: any) => {
                    // noinspection JSUnresolvedReference
                    return stream.itemType.post;
                })
                .map((post: any) => {
                    return post.title;
                });

        // noinspection JSUnresolvedReference
        const next: number =
            posts.length === pageLimit
                ? resp_data.data.user.profileStreamConnection
                      .pagingInfo.next.to
                : null;

        return {
            posts,
            next,
        };
    }

    /**
     * Gets an existing post by title.
     * @param {string} title - The title of the post to find.
     * @returns {Promise<Post | null>} The post if found, otherwise null. I prefer null to undefined but dealers choice
     * @throws {NoUserNameError} no user name provided
     */
    async getByTitle(title: string): Promise<PublishedPost | null> {
        if(!this._userName){
            throw new Error('No user name provided');
        }
        const posts = await this.getPosts(this._userName);
        const post = posts.find((p) => p.title === title);
        return post || null;
    }

    /**
     * "Updates" a post by creating a new version with updated content.
     * Since Medium API doesn't support deletion, this method creates a new post with the same title
     * and sets the canonicalUrl to the original post's URL, indicating that it supersedes the original.
     * @param {string} postId - The ID of the post to update.
     * @param {CreatePostRequest} updateData - The updated post data.
     * @returns {Promise<Post>} The updated post.
     */
    async updateById(postId: string, updateData: CreatePostRequest): Promise<Post> {
        const originalPost = await this._getPostById(postId); // Fetch the original post details if available
        if (originalPost) {
            updateData.canonicalUrl = originalPost.link; // Use original post's URL for SEO
            updateData.title = `${updateData.title}`; // Optionally distinguish versions
        }
        return this.createPost(updateData);
    }

    /**
     * Finds a post by title and updates it if found, otherwise does nothing.
     * Since Medium API doesn't support deletion, this method creates a new post with the same title
     * and sets the canonicalUrl to the original post's URL if it exists.
     * @param {string} title - The title of the post to update.
     * @param {CreatePostRequest} updateData - The updated post data.
     * @returns {Promise<Post | null>} The updated post if found, otherwise null.
     */
    async updateByTitle(title: string, updateData: CreatePostRequest): Promise<Post | null> {
        const post = await this.getByTitle(title);
        if (post) {
            return this.updateById(post.id, updateData);
        }
        return null;
    }

    /**
     * Creates or updates a post by title.
     * If a post with the specified title exists, it creates a new version with updated content.
     * If not, it creates a new post without any canonicalUrl.
     * @param {string} title - The title of the post.
     * @param {CreatePostRequest} updateData - The post data for creation or update.
     * @returns {Promise<Post>} The created or updated post data.
     */
    async createOrUpdateByTitle(title: string, updateData: CreatePostRequest): Promise<Post> {
        const existingPost = await this.getByTitle(title);
        if (existingPost) {
            return this.updateById(existingPost.id, updateData);
        } else {
            return this.createPost(updateData);
        }
    }

    /**
     * Fetches post details by ID.
     * Since Medium API doesn’t support direct fetching by ID, this uses existing methods as a workaround.
     * @param {string} postId - The ID of the post to fetch.
     * @returns {Promise<PublishedPost | null>} The post details if found, otherwise null.
     */
    private async _getPostById(postId: string): Promise<PublishedPost | null> {
        if(!this._userName){
            throw new Error('No user name provided');
        }
        const posts = await this.getPosts(this._userName); 
        const post = posts.find((p) => p.id === postId);
        return post || null;
    }
}

const graphqlQuery = `
query UserStreamOverview($userId: ID!, $pagingOptions: PagingOptions) {
  user(username: $userId) {
    name
    profileStreamConnection(paging: $pagingOptions) {
      ...commonStreamConnection
      __typename
    }
    __typename
  }
}
fragment commonStreamConnection on StreamConnection {
  pagingInfo {
    next {
      limit
      page
      source
      to
      ignoredIds
      __typename
    }
    __typename
  }
  stream {
    ...StreamItemList_streamItem
    __typename
  }
  __typename
}
fragment StreamItemList_streamItem on StreamItem {
  ...StreamItem_streamItem
  __typename
}
fragment StreamItem_streamItem on StreamItem {
  itemType {
    __typename
    ... on StreamItemPostPreview {
        post {
            id
            mediumUrl
            title
            firstPublishedAt
            tags {
                id
            }
            __typename
        }
      __typename
    }
  }
  __typename
}
`;

const graphqlQueryMin = `
query UserStreamOverview($userId: ID!, $pagingOptions: PagingOptions) {
  user(username: $userId) {
    profileStreamConnection(paging: $pagingOptions) {
      ...commonStreamConnection
      __typename
    }
    __typename
  }
}
fragment commonStreamConnection on StreamConnection {
  pagingInfo {
    next {
      limit
      to
      __typename
    }
    __typename
  }
  stream {
    ...StreamItemList_streamItem
    __typename
  }
  __typename
}
fragment StreamItemList_streamItem on StreamItem {
  ...StreamItem_streamItem
  __typename
}
fragment StreamItem_streamItem on StreamItem {
  itemType {
    __typename
    ... on StreamItemPostPreview {
        post {
            title
            __typename
        }
      __typename
    }
  }
  __typename
}
`;

const pageLimit = 25;

// Exports
export {
    MediumClient,
    MediumError,
    PostPublishStatus,
    PostLicense,
    PostContentFormat,
};
