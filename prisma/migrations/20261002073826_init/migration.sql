-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NULL,
    `status` ENUM('QUEUED', 'EXTRACTING', 'CONVERTING', 'INDEXING', 'READY', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `stage` VARCHAR(191) NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `pageCount` INTEGER NULL,
    `charCount` INTEGER NULL,
    `tokenEstimate` INTEGER NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `warnings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Document_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentFile` (
    `documentId` VARCHAR(191) NOT NULL,
    `original` LONGBLOB NOT NULL,
    `rendition` LONGBLOB NULL,

    PRIMARY KEY (`documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentText` (
    `documentId` VARCHAR(191) NOT NULL,
    `text` LONGTEXT NOT NULL,

    PRIMARY KEY (`documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentPage` (
    `documentId` VARCHAR(191) NOT NULL,
    `pageNo` INTEGER NOT NULL,
    `charStart` INTEGER NOT NULL,
    `charEnd` INTEGER NOT NULL,
    `width` DOUBLE NOT NULL,
    `height` DOUBLE NOT NULL,
    `items` JSON NOT NULL,

    PRIMARY KEY (`documentId`, `pageNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationDocument` (
    `conversationId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`conversationId`, `documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `status` ENUM('STREAMING', 'COMPLETE', 'STOPPED', 'ERROR') NOT NULL DEFAULT 'COMPLETE',
    `coverage` JSON NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Message_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quote` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `ref` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `verified` BOOLEAN NOT NULL,
    `matchKind` VARCHAR(191) NULL,
    `failReason` VARCHAR(191) NULL,
    `ranges` JSON NULL,

    INDEX `Quote_messageId_idx`(`messageId`),
    INDEX `Quote_documentId_idx`(`documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Comparison` (
    `id` VARCHAR(191) NOT NULL,
    `docAId` VARCHAR(191) NOT NULL,
    `docBId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NULL,
    `summary` LONGTEXT NULL,
    `stats` JSON NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComparisonChange` (
    `id` VARCHAR(191) NOT NULL,
    `comparisonId` VARCHAR(191) NOT NULL,
    `orderIdx` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `significance` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,
    `summarySource` VARCHAR(191) NOT NULL,
    `aText` TEXT NULL,
    `bText` TEXT NULL,
    `aStart` INTEGER NULL,
    `aEnd` INTEGER NULL,
    `bStart` INTEGER NULL,
    `bEnd` INTEGER NULL,

    INDEX `ComparisonChange_comparisonId_idx`(`comparisonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Redline` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `instruction` TEXT NOT NULL,
    `edits` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `output` LONGBLOB NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Redline_documentId_idx`(`documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentFile` ADD CONSTRAINT `DocumentFile_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentText` ADD CONSTRAINT `DocumentText_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentPage` ADD CONSTRAINT `DocumentPage_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationDocument` ADD CONSTRAINT `ConversationDocument_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationDocument` ADD CONSTRAINT `ConversationDocument_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComparisonChange` ADD CONSTRAINT `ComparisonChange_comparisonId_fkey` FOREIGN KEY (`comparisonId`) REFERENCES `Comparison`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
